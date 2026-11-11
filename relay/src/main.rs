use clap::Parser;
use h_router_relay::{RelayConfig, run};

#[derive(Parser, Debug)]
#[command(name = "h-router-relay", version, about = "h-router relay sidecar: HTTP proxy (absolute-form + CONNECT) and x-relay-target relay")]
struct Args {
    /// Listen address, e.g. 127.0.0.1:20129
    #[arg(long)]
    listen: Option<String>,
    /// Header profile: codebuddy | kimi | minimax | muse | cline | kilocode | none
    #[arg(long)]
    profile: Option<String>,
    /// Config file (TOML or JSON). Also via HROUTER_RELAY_CONFIG.
    #[arg(long)]
    config: Option<String>,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    let cfg = match RelayConfig::from_env_and_file(
        args.config.as_deref(),
        args.listen,
        args.profile,
    ) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("h-router-relay: {e}");
            std::process::exit(2);
        }
    };
    let addr: std::net::SocketAddr = match cfg.listen.parse() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("h-router-relay: invalid listen address {}: {e}", cfg.listen);
            std::process::exit(2);
        }
    };
    eprintln!(
        "h-router-relay: listening on {addr} profile={} (x-hrouter-relay: 1)",
        cfg.profile
    );
    if let Err(e) = run(addr, cfg).await {
        eprintln!("h-router-relay: server error: {e}");
        std::process::exit(1);
    }
}
