"use client";

import { LANDING_BRANDS } from "@/shared/constants/landing.js";

// Logo strip under the hero. The strip follows the admin catalog: the
// parent passes `brands` (resolveCatalogBrands over the published models),
// so the strip shows exactly the brands the landing serves — one brand
// when the admin picked one model, all of them when nothing is picked.
// `brands` undefined means the catalog is still loading: the static
// config list renders instead so the strip is never blank. An empty array
// means the catalog published no brands at all, so nothing renders.
// Logos are vendored SVGs in public/brands/; brands without one get a
// styled initial badge — never a broken image. Chips stay white in both
// themes so the monochrome brand marks always read.
export default function BrandStrip({ brands } = {}) {
  const list = brands === undefined ? LANDING_BRANDS : brands;
  if (!Array.isArray(list) || list.length === 0) return null;
  return (
    <section aria-label="Brand model yang dilayani" className="mx-auto mt-14 w-full max-w-6xl px-6">
      <p className="text-center text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
        Satu kunci — model dari brand-brand ini
      </p>
      <ul className="mt-4 flex flex-wrap items-center justify-center gap-2 md:gap-3">
        {list.map((b) => (
          <li
            key={b.name}
            className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm"
          >
            {b.logo ? (
              <img src={b.logo} alt="" aria-hidden="true" width={20} height={20} loading="lazy" className="h-5 w-5" />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-5 w-5 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-extrabold text-white"
              >
                {b.name.charAt(0)}
              </span>
            )}
            <span className="text-sm font-bold text-zinc-800">{b.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
