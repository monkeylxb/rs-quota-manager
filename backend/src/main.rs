//! 插件协议会话与串行管理入口

mod engine;
mod host;
mod management;
mod model;
mod native;

use gateway_plugin_sdk::{
    Manifest,
    client::{PluginBuilder, PluginSession, SessionConfig, SessionError},
};
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let session = PluginSession::accept(
        tokio::io::stdin(),
        tokio::io::stdout(),
        SessionConfig::default(),
    )
    .await?;
    let manifest = Manifest::from_author_slice(include_bytes!("../../plugin.json"))?;
    if session.handshake().plugin_id != manifest.plugin_id()?
        || session.handshake().contributes != manifest.contributes
    {
        return Err(SessionError::Handshake.into());
    }
    let lock = Arc::new(Mutex::new(()));
    let plugin = PluginBuilder::from_json(include_bytes!("../../plugin.json"))?
        .management(management::registration(), move |call| {
            let lock = Arc::clone(&lock);
            async move {
                let _guard = lock.lock().await;
                management::handle(call).await
            }
        })?
        .build()?;
    session.run(plugin).await?;
    Ok(())
}
