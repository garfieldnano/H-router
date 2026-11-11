"use server";

import { NextResponse } from "next/server";
import { GET as claudeGet } from "../claude-settings/route";
import { GET as codexGet } from "../codex-settings/route";
import { GET as opencodeGet } from "../opencode-settings/route";
import { GET as droidGet } from "../droid-settings/route";
import { GET as openclawGet } from "../openclaw-settings/route";
import { GET as hermesGet } from "../hermes-settings/route";
import { GET as coworkGet } from "../cowork-settings/route";
import { GET as clineGet } from "../cline-settings/route";
import { GET as kiloGet } from "../kilo-settings/route";
import { GET as deepseekTuiGet } from "../deepseek-tui-settings/route";
import { GET as jcodeGet } from "../jcode-settings/route";
import { GET as grokBuildGet } from "../grok-build-settings/route";
import { GET as devinGet } from "../devin-settings/route";
import { GET as piGet } from "../pi-settings/route";
import { GET as ompGet } from "../omp-settings/route";
import { GET as crushGet } from "../crush-settings/route";
import { GET as forgeGet } from "../forge-settings/route";
import { GET as smeltGet } from "../smelt-settings/route";
import { GET as codewhaleGet } from "../codewhale-settings/route";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";

const STATUS_GETTERS = {
  claude: claudeGet,
  codex: codexGet,
  opencode: opencodeGet,
  droid: droidGet,
  openclaw: openclawGet,
  hermes: hermesGet,
  cowork: coworkGet,
  cline: clineGet,
  kilo: kiloGet,
  "deepseek-tui": deepseekTuiGet,
  jcode: jcodeGet,
  "grok-build": grokBuildGet,
  devin: devinGet,
  pi: piGet,
  omp: ompGet,
  crush: crushGet,
  forge: forgeGet,
  smelt: smeltGet,
  codewhale: codewhaleGet,
};

// Per-tool settings GETs return the raw host CLI config (e.g. ~/.claude/
// settings.json), which can contain the configured auth token. Members
// only get installed/configured booleans — never the host config itself.
function scrubForMember(data) {
  if (!data || typeof data !== "object") return data;
  const { installed = false, has9Router = false, message, exaMcpEnabled } = data;
  return {
    installed,
    has9Router,
    ...(message !== undefined ? { message } : {}),
    ...(exaMcpEnabled !== undefined ? { exaMcpEnabled } : {}),
  };
}

// Batch endpoint: gather all CLI tool statuses in one round-trip
export async function GET() {
  const member = await getRequestMemberSession();
  const entries = await Promise.all(
    Object.entries(STATUS_GETTERS).map(async ([toolId, getter]) => {
      try {
        const res = await getter();
        const data = await res.json();
        return [toolId, member ? scrubForMember(data) : data];
      } catch {
        return [toolId, null];
      }
    })
  );
  return NextResponse.json(Object.fromEntries(entries));
}
