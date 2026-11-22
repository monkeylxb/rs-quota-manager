//! 旧版未决用卡状态和额度恢复判断

use gateway_plugin_sdk::call::data::QuotaDetails;
use serde::{Deserialize, Serialize};

pub fn is_free(plan_type: Option<&str>) -> bool {
    plan_type.is_some_and(|plan| plan.trim().eq_ignore_ascii_case("free"))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub request_id: String,
    pub credit_id: Option<String>,
    pub started_at_ms: i64,
    pub automatic: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub at_ms: i64,
    pub request_id: String,
    pub credit_id: Option<String>,
    pub automatic: bool,
    pub code: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountState {
    pub error: Option<String>,
    pub pending: Option<Pending>,
    pub awaiting_recovery: bool,
    pub last_attempt_at_ms: Option<i64>,
    pub history: Vec<Event>,
}

impl AccountState {
    pub fn clear_legacy_query_error(&mut self) {
        if self.error.as_deref() == Some("重置卡查询失败，保留上次快照") {
            self.error = None;
        }
    }

    pub fn note_recovery(&mut self, quota: &QuotaDetails) -> bool {
        if !self.awaiting_recovery
            || !matches!((quota.observed_at_ms, self.last_attempt_at_ms), (Some(observed), Some(last)) if observed > last)
        {
            return false;
        }
        let mut weekly = quota.windows.iter().filter(|window| {
            window.window_seconds == Some(604800)
                && window
                    .key
                    .split(':')
                    .next()
                    .is_some_and(|key| key.eq_ignore_ascii_case("codex"))
        });
        if weekly
            .next()
            .is_some_and(|window| window.used_percent.is_some_and(|used| used < 100.0))
            && weekly.next().is_none()
        {
            self.awaiting_recovery = false;
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gateway_plugin_sdk::call::data::QuotaWindowDetails;

    fn quota(used: f64, observed: i64) -> QuotaDetails {
        QuotaDetails {
            schema_version: 1,
            account_id: "a".into(),
            observed_at_ms: Some(observed),
            limit_reached: false,
            credits: None,
            windows: vec![QuotaWindowDetails {
                key: "codex:604800s".into(),
                group: "codex".into(),
                label: "周限".into(),
                limit_id: None,
                limit_name: None,
                role: None,
                window_seconds: Some(604800),
                used_percent: Some(used),
                reset_at_ms: Some(99999),
                limit_reached: false,
            }],
        }
    }

    #[test]
    fn recovery_must_postdate_consumption() {
        let mut state = AccountState {
            awaiting_recovery: true,
            last_attempt_at_ms: Some(1000),
            ..Default::default()
        };
        assert!(!state.note_recovery(&quota(0.0, 999)));
        assert!(state.awaiting_recovery);
        assert!(!state.note_recovery(&quota(100.0, 1001)));
        assert!(state.awaiting_recovery);
        assert!(state.note_recovery(&quota(0.0, 1001)));
        assert!(!state.awaiting_recovery);
    }
}
