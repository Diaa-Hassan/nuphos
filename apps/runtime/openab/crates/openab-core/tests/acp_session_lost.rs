//! An agent that exits after its session died must be rebuilt and resumed.
//!
//! claude-agent-acp exits (patched in apps/runtime/image/claude-agent-acp) when the
//! Claude Code process under it dies. The pool must then drop the dead connection,
//! spawn a fresh agent on the next message, and resume the same session through
//! session/load instead of failing every later message.
#![cfg(unix)]
use openab_core::acp::SessionPool;
use openab_core::config::AgentConfig;
use std::collections::HashMap;
use std::time::Duration;

#[tokio::test]
async fn an_agent_that_exits_is_rebuilt_and_resumed_on_the_next_message() {
    let tmp = tempfile::tempdir().unwrap();
    // This integration-test binary owns its HOME; isolate pool persistence.
    std::env::set_var("HOME", tmp.path());
    let script = tmp.path().join("agent.sh");
    let record = tmp.path().join("calls");
    // The first process loses its session right after creating it and exits,
    // the way the patched claude-agent-acp handles a dead Claude Code process.
    // A restored process (session/load) stays healthy.
    std::fs::write(&script, r##"#!/bin/sh
echo "spawn" >> "$RECORD"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*) result='{"agentInfo":{"name":"fixture"},"agentCapabilities":{"loadSession":true}}';;
    *'"session/new"'*)
      echo "new" >> "$RECORD"
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"inner"}}\n' "$id"
      sleep 0.1
      echo "Session inner: Claude Agent process died: Claude Code process terminated by signal SIGABRT." >&2
      exit 1;;
    *'"session/load"'*) echo "load $line" >> "$RECORD"; result='{}';;
    *) result='{}';;
  esac
  [ -n "$id" ] && printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$id" "$result"
done
"##).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let pool = SessionPool::new(
        AgentConfig {
            command: script.to_string_lossy().into(),
            args: vec![],
            working_dir: tmp.path().to_string_lossy().into(),
            env: HashMap::from([("RECORD".into(), record.to_string_lossy().into())]),
            inherit_env: vec![],
            command_explicit: true,
        },
        4,
        60,
        HashMap::new(),
    );

    pool.get_or_create("thread", None, &[], None).await.unwrap();
    // The connection reads as dead once the agent process has exited.
    let mut lost = false;
    for _ in 0..50 {
        lost = pool
            .with_connection("thread", |conn| Box::pin(async move { Ok(!conn.alive()) }))
            .await
            .unwrap();
        if lost {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        lost,
        "the connection must stop reporting alive once its session is gone"
    );

    // The next message rebuilds the connection and resumes the same session.
    pool.get_or_create("thread", None, &[], None).await.unwrap();
    let alive = pool
        .with_connection("thread", |conn| {
            Box::pin(async move { Ok((conn.alive(), conn.acp_session_id.clone())) })
        })
        .await
        .unwrap();
    assert_eq!(alive, (true, Some("inner".to_string())));
    let calls = std::fs::read_to_string(&record).unwrap();
    assert_eq!(calls.matches("spawn").count(), 2, "{calls}");
    assert_eq!(calls.matches("new\n").count(), 1, "{calls}");
    assert!(
        calls
            .lines()
            .any(|l| l.starts_with("load ") && l.contains("\"inner\"")),
        "the rebuilt connection must session/load the lost session: {calls}"
    );
}
