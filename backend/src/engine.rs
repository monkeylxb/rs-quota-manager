//! 宿主账号校验、额度快照和旧版未决用卡确认

use crate::{
    host::{admin, fault, load, now, save},
    model::{AccountState, Event, is_free},
};
use gateway_plugin_sdk::{
    PluginFault,
    call::{
        data::{QuotaDetails, QuotaFactsQuery},
        host::{AUTH_GET_RUNTIME, AuthGetRequest, AuthRuntimeAccount},
    },
    client::HostClient,
};
use serde_json::{Value, json};

fn key(id: &str) -> String {
    format!("account/{id}")
}

pub async fn detail(host: &HostClient, id: &str) -> Result<AuthRuntimeAccount, PluginFault> {
    let request = AuthGetRequest {
        account_id: id.to_owned(),
    };
    let reply = host
        .call(
            AUTH_GET_RUNTIME,
            json!({}),
            serde_json::to_vec(&request).map_err(|_| fault("账号参数无效"))?,
        )
        .await
        .map_err(|e| e.into_plugin_fault())?;
    let value: AuthRuntimeAccount =
        serde_json::from_slice(&reply.payload).map_err(|_| fault("账号状态无效"))?;
    if value.account_id != id {
        return Err(fault("账号详情不匹配"));
    }
    Ok(value)
}

pub fn require_non_free(account: &AuthRuntimeAccount) -> Result<(), PluginFault> {
    if is_free(account.plan_type.as_deref()) {
        return Err(fault("RS 当前套餐为 Free，该账号不参与此插件"));
    }
    Ok(())
}

pub async fn account_snapshot(
    host: &HostClient,
    id: &str,
    include_quota: bool,
) -> Result<(AccountState, Option<QuotaDetails>), PluginFault> {
    let key = key(id);
    let (mut state, version) = load::<AccountState>(host, &key).await?;
    state.clear_legacy_query_error();
    let quota = if include_quota {
        host.quota_details(QuotaFactsQuery {
            account_id: id.into(),
        })
        .await
        .ok()
    } else {
        None
    };
    if quota
        .as_ref()
        .is_some_and(|quota| state.note_recovery(quota))
    {
        save(host, &key, &state, version).await?;
    }
    Ok((state, quota))
}

pub async fn confirm_pending(
    host: &HostClient,
    id: &str,
    request_id: &str,
) -> Result<AccountState, PluginFault> {
    let key = key(id);
    let (mut state, version) = load::<AccountState>(host, &key).await?;
    let operation = state
        .pending
        .as_ref()
        .ok_or_else(|| fault("原操作已结束，请读取最新快照"))?;
    if request_id != operation.request_id {
        return Err(fault("请求标识与原操作不匹配"));
    }

    // 旧版未决操作只能复用原卡和请求标识，避免重复消费
    let result = admin(
        host,
        "POST",
        "/api/admin/accounts/reset-credits",
        Some(json!({
            "accountId": id, "creditId": operation.credit_id, "redeemRequestId": operation.request_id
        })),
    )
    .await;
    let code = result
        .as_ref()
        .ok()
        .and_then(|value| value.get("code"))
        .and_then(Value::as_str)
        .filter(|code| {
            matches!(
                *code,
                "reset" | "already_redeemed" | "no_credit" | "nothing_to_reset"
            )
        });
    if let Some(code) = code {
        let confirmed = matches!(code, "reset" | "already_redeemed");
        let at_ms = now();
        state.awaiting_recovery |= confirmed;
        state.last_attempt_at_ms = Some(at_ms);
        state.error = (!confirmed).then(|| format!("上游未执行重置：{code}"));
        state.history.insert(
            0,
            Event {
                at_ms,
                request_id: operation.request_id.clone(),
                credit_id: operation.credit_id.clone(),
                automatic: operation.automatic,
                code: code.into(),
            },
        );
        state.history.truncate(20);
        state.pending = None;
    } else {
        state.error = Some("消费结果待确认，请确认原操作".into());
    }
    save(host, &key, &state, version).await?;
    Ok(state)
}
