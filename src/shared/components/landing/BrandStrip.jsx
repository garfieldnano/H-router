"use client";

// Logo strip under the hero. The strip follows the admin catalog: the
// parent passes `brands` (resolveCatalogBrands over the published models),
// so the strip shows exactly the brands the landing serves — one brand
// when the admin picked one model, all of them when nothing is picked.
// `brands` undefined means the catalog is still loading: NOTHING renders
// (no static fallback list), so a refresh never flashes the wrong brands
// before the real catalog arrives. An empty array means the catalog
// published no brands at all, so nothing renders either.
// Logos are vendored SVGs in public/brands/; brands without one get a
// styled initial badge — never a broken image. Chips stay white in both
// themes so the monochrome brand marks always read.
//
// When the catalog serves many brands (7+), the strip becomes a marquee:
// the list scrolls horizontally (4 copies, -25% loop, pauses on hover)
// so a growing brand list never wraps into a tall block. With few brands
// it stays a static centered row. Duplicate copies are aria-hidden.
const MARQUEE_MIN = 7;

function BrandChip({ brand, hidden }) {
  return (
    <li
      aria-hidden={hidden || undefined}
      className="flex shrink-0 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm"
    >
      {brand.logo ? (
        <img src={brand.logo} alt="" aria-hidden="true" width={20} height={20} loading="lazy" className="h-5 w-5" />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-extrabold text-white"
        >
          {brand.name.charAt(0)}
        </span>
      )}
      <span className="text-sm font-bold text-zinc-800">{brand.name}</span>
    </li>
  );
}

export default function BrandStrip({ brands } = {}) {
  const list = brands;
  if (!Array.isArray(list) || list.length === 0) return null;
  const marquee = list.length >= MARQUEE_MIN;
  return (
    <section aria-label="Brand model yang dilayani" className="mx-auto mt-14 w-full max-w-6xl px-6">
      <p className="text-center text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
        Satu kunci — model dari brand-brand ini
      </p>
      {marquee ? (
        <div className="brand-marquee mt-4 overflow-hidden">
          <ul className="brand-marquee-track flex w-max items-center gap-2 md:gap-3">
            {[...list, ...list, ...list, ...list].map((b, i) => (
              <BrandChip key={`${b.name}-${i}`} brand={b} hidden={i >= list.length} />
            ))}
          </ul>
        </div>
      ) : (
        <ul className="mt-4 flex flex-wrap items-center justify-center gap-2 md:gap-3">
          {list.map((b) => (
            <BrandChip key={b.name} brand={b} />
          ))}
        </ul>
      )}
    </section>
  );
}
