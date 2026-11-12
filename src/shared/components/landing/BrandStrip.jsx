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
  // The DeepSeek whale artwork is shorter than the other marks (its
  // pixels fill 128x95 of a 128 canvas, vs ~118x118 for Gemini and
  // 128x128 for Claude), so it renders a touch larger to match the
  // others' optical size.
  const tall = brand.name === "DeepSeek";
  return (
    <li aria-hidden={hidden || undefined} className="flex shrink-0 items-center gap-2.5">
      {brand.logo ? (
        <img src={brand.logo} alt="" aria-hidden="true" width={tall ? 28 : 24} height={tall ? 28 : 24} loading="lazy" className={tall ? "h-7 w-7" : "h-6 w-6"} />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-extrabold text-white"
        >
          {brand.name.charAt(0)}
        </span>
      )}
      <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{brand.name}</span>
    </li>
  );
}

export default function BrandStrip({ brands } = {}) {
  const list = brands;
  if (!Array.isArray(list) || list.length === 0) return null;
  const marquee = list.length >= MARQUEE_MIN;
  return (
    <section aria-label="Brand model yang dilayani" className="mx-auto mt-10 w-full max-w-6xl px-6">
      <p className="text-center text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
        Satu kunci — model dari brand-brand ini
      </p>
      {marquee ? (
        <div className="brand-marquee mt-5 overflow-hidden">
          <ul className="brand-marquee-track flex w-max items-center gap-8 md:gap-10">
            {[...list, ...list, ...list, ...list].map((b, i) => (
              <BrandChip key={`${b.name}-${i}`} brand={b} hidden={i >= list.length} />
            ))}
          </ul>
        </div>
      ) : (
        <ul className="mx-auto mt-5 flex max-w-2xl flex-wrap items-center justify-center gap-6 md:gap-10">
          {list.map((b) => (
            <BrandChip key={b.name} brand={b} />
          ))}
        </ul>
      )}
    </section>
  );
}
