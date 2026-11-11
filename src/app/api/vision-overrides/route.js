import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo.js";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";

export const dynamic = "force-dynamic";

// Admin-only: the dashboard guard blocks member sessions from
// /api/vision-overrides*, this check is defense in depth.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

// Override keys look like model ids: "provider/model" or a brand id
// ("h-router/ultra-pro"). No spaces, must contain one slash.
function validateKey(key) {
  const k = typeof key === "string" ? key.trim() : "";
  if (!k || k.length > 200 || /\s/.test(k) || !k.includes("/")) return null;
  if (k.startsWith("/") || k.endsWith("/")) return null;
  return k;
}

function cleanOverrides(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      const key = validateKey(k);
      if (key && typeof v === "boolean") out[key] = v;
    }
  }
  return out;
}

// GET /api/vision-overrides — the admin vision override map
// { "provider/model": true|false, "brand-id": true|false }
export async function GET() {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const settings = await getSettings();
    return NextResponse.json({ overrides: cleanOverrides(settings?.visionOverrides) });
  } catch (error) {
    console.log("Error fetching vision overrides:", error);
    return NextResponse.json({ error: "Failed to fetch vision overrides" }, { status: 500 });
  }
}

// PUT /api/vision-overrides — set one override { key, vision: boolean }
export async function PUT(request) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const data = await request.json();
    const key = validateKey(data?.key);
    if (!key) {
      return NextResponse.json(
        { error: "key harus berbentuk 'provider/model' tanpa spasi" },
        { status: 400 }
      );
    }
    if (typeof data?.vision !== "boolean") {
      return NextResponse.json({ error: "vision harus boolean" }, { status: 400 });
    }
    const settings = await getSettings();
    const overrides = { ...cleanOverrides(settings?.visionOverrides), [key]: data.vision };
    await updateSettings({ visionOverrides: overrides });
    return NextResponse.json({ overrides });
  } catch (error) {
    console.log("Error saving vision override:", error);
    return NextResponse.json({ error: "Failed to save vision override" }, { status: 500 });
  }
}

// DELETE /api/vision-overrides?key=provider/model — clear one override
export async function DELETE(request) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const key = validateKey(new URL(request.url).searchParams.get("key"));
    if (!key) {
      return NextResponse.json(
        { error: "key harus berbentuk 'provider/model' tanpa spasi" },
        { status: 400 }
      );
    }
    const settings = await getSettings();
    const overrides = cleanOverrides(settings?.visionOverrides);
    delete overrides[key];
    await updateSettings({ visionOverrides: overrides });
    return NextResponse.json({ overrides });
  } catch (error) {
    console.log("Error deleting vision override:", error);
    return NextResponse.json({ error: "Failed to delete vision override" }, { status: 500 });
  }
}
