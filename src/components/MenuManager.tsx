import { useEffect, useState } from "react";
import {
  DEFAULT_MENU,
  DEFAULT_SAUCES,
  MENU_CATEGORIES,
  mergeDefaultPromos,
  type MenuExtra,
  type MenuItem,
  type MenuVariant,
} from "@/lib/menu-data";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

const field =
  "w-full rounded-md bg-ink px-3 py-2.5 text-sm text-cream ring-1 ring-white/15 outline-none focus:ring-ember";
const label = "mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-cream-dim";
const imageAssets = import.meta.glob("/src/assets/menu/*.{png,jpg,jpeg}", {
  eager: true,
  import: "default",
}) as Record<string, string>;
const weekdays = [
  { day: 1, label: "Lun" },
  { day: 2, label: "Mar" },
  { day: 3, label: "Mié" },
  { day: 4, label: "Jue" },
  { day: 5, label: "Vie" },
  { day: 6, label: "Sáb" },
  { day: 0, label: "Dom" },
];
const categoryFilters = [{ id: "all", label: "Todas" }, ...MENU_CATEGORIES] as const;
type MenuItemPatch = { [K in keyof MenuItem]?: MenuItem[K] | undefined };
type MenuVariantPatch = { [K in keyof MenuVariant]?: MenuVariant[K] | undefined };

const imageSrc = (image: string) =>
  image.startsWith("http") || image.startsWith("/")
    ? image
    : (imageAssets[`/src/assets/menu/${image}`] ?? "");

function cloneDefaults() {
  return structuredClone(DEFAULT_MENU);
}

export function MenuManager() {
  const [items, setItems] = useState<MenuItem[]>(cloneDefaults);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [category, setCategory] = useState<(typeof categoryFilters)[number]["id"]>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    supabase
      .from("menu_content")
      .select("items")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error)
          setMessage("No se pudo leer el menú. Aplicá la migración de Supabase y volvé a cargar.");
        else if (Array.isArray(data?.items))
          setItems(mergeDefaultPromos(data.items as unknown as MenuItem[]));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const item = items[selectedIndex];
  const filtered = items
    .map((menuItem, index) => ({ menuItem, index }))
    .filter(({ menuItem }) => category === "all" || menuItem.category === category);

  const updateItem = (patch: MenuItemPatch) => {
    setItems((current) =>
      current.map((entry, index) =>
        index === selectedIndex ? ({ ...entry, ...patch } as MenuItem) : entry,
      ),
    );
  };

  const updateVariant = (variantIndex: number, patch: MenuVariantPatch) => {
    if (!item) return;
    const variants = [...(item.variants ?? [])];
    variants[variantIndex] = { ...variants[variantIndex]!, ...patch } as MenuVariant;
    updateItem({ variants });
  };

  const uploadImage = async (file?: File) => {
    if (!file || !item) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setMessage("Elegí una imagen de hasta 5 MB.");
      return;
    }
    setUploading(true);
    setMessage("");
    const path = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const { error } = await supabase.storage
      .from("menu-images")
      .upload(path, file, { cacheControl: "3600", upsert: false });
    setUploading(false);
    if (error) {
      setMessage("No se pudo subir la imagen. Revisá que la migración de Supabase esté aplicada.");
      return;
    }
    updateItem({ image: supabase.storage.from("menu-images").getPublicUrl(path).data.publicUrl });
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    const { error } = await supabase.from("menu_content").upsert({
      id: 1,
      items: items as unknown as Database["public"]["Tables"]["menu_content"]["Insert"]["items"],
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    setMessage(
      error
        ? "No se pudo guardar. Revisá tu conexión y el permiso de edición del menú."
        : "Menú guardado. La página pública se actualiza automáticamente.",
    );
  };

  const addItem = () => {
    const nextIndex = items.length;
    setItems((current) => [
      ...current,
      {
        name: "Nuevo producto",
        desc: "",
        image: "burguers-fritas-burger-point.png",
        category: "burgers",
        enabled: true,
      },
    ]);
    setSelectedIndex(nextIndex);
    setCategory("all");
  };

  const removeItem = () => {
    if (!item || !window.confirm(`¿Eliminar ${item.name} del menú?`)) return;
    setItems((current) => current.filter((_, index) => index !== selectedIndex));
    setSelectedIndex(Math.max(0, selectedIndex - 1));
  };

  return (
    <main className="px-5 pb-10 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember">
              Administración
            </p>
            <h1 className="mt-1 font-display text-4xl">Menú del local</h1>
          </div>
          <button
            onClick={save}
            disabled={saving || loading}
            className="rounded-full bg-ember px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>

        {message && (
          <p role="status" className="mb-5 text-sm text-ember">
            {message}
          </p>
        )}
        {loading ? (
          <p className="text-cream-dim">Cargando menú…</p>
        ) : (
          <>
            <nav
              aria-label="Secciones del menú"
              className="mb-6 flex gap-2 overflow-x-auto border-b border-white/10 pb-3"
            >
              {categoryFilters.map((entry) => {
                const count =
                  entry.id === "all"
                    ? items.length
                    : items.filter((menuItem) => menuItem.category === entry.id).length;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={category === entry.id}
                    onClick={() => {
                      setCategory(entry.id);
                      const firstVisibleIndex = items.findIndex(
                        (menuItem) => entry.id === "all" || menuItem.category === entry.id,
                      );
                      setSelectedIndex(firstVisibleIndex);
                    }}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${category === entry.id ? "bg-ember text-ink" : "text-cream-dim ring-1 ring-white/10 hover:bg-ink-2 hover:text-cream"}`}
                  >
                    {entry.label}
                    <span className="font-mono text-[10px] opacity-70">{count}</span>
                  </button>
                );
              })}
            </nav>

            <div className="grid gap-8 md:grid-cols-[250px_minmax(0,1fr)]">
            <aside>
              <div className="mb-3 flex items-center justify-between gap-2">
                <label className={label}>Productos</label>
                <button
                  onClick={addItem}
                  className="text-sm font-semibold text-ember hover:text-cream"
                >
                  ＋ Agregar
                </button>
              </div>
              <div className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
                {filtered.length === 0 ? (
                  <p className="px-3 py-2.5 text-sm text-cream-dim">
                    No hay productos en esta sección.
                  </p>
                ) : filtered.map(({ menuItem, index }) => (
                  <button
                    key={`${index}-${menuItem.name}`}
                    onClick={() => setSelectedIndex(index)}
                    className={`block w-full truncate rounded-md px-3 py-2.5 text-left text-sm ${selectedIndex === index ? "bg-ember text-ink" : "text-cream-dim hover:bg-ink-2 hover:text-cream"} ${menuItem.enabled === false ? "opacity-50" : ""}`}
                  >
                    {menuItem.name || "Sin nombre"}
                  </button>
                ))}
              </div>
            </aside>

            {item ? (
              <section className="min-w-0">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className={label}>Nombre</span>
                    <input
                      className={field}
                      value={item.name}
                      onChange={(event) => updateItem({ name: event.target.value })}
                    />
                  </label>
                  <label>
                    <span className={label}>Categoría</span>
                    <select
                      className={field}
                      value={item.category}
                      onChange={(event) => {
                        const nextCategory = event.target.value as MenuItem["category"];
                        updateItem({ category: nextCategory });
                        setCategory(nextCategory);
                      }}
                    >
                      {MENU_CATEGORIES.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sm:col-span-2">
                    <span className={label}>Descripción</span>
                    <textarea
                      className={field}
                      rows={2}
                      value={item.desc}
                      onChange={(event) => updateItem({ desc: event.target.value })}
                    />
                  </label>
                  <label>
                    <span className={label}>Precio (ARS)</span>
                    <input
                      className={field}
                      type="number"
                      min="0"
                      value={item.price ?? ""}
                      onChange={(event) =>
                        updateItem({
                          price: event.target.value === "" ? undefined : Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span className={label}>Etiqueta</span>
                    <input
                      className={field}
                      value={item.tag ?? ""}
                      onChange={(event) => updateItem({ tag: event.target.value || undefined })}
                    />
                  </label>

                  <div className="sm:col-span-2">
                    <label className={label}>Imagen del producto</label>
                    <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                      <div className="aspect-[4/3] overflow-hidden rounded-md bg-ink-2 ring-1 ring-white/10">
                        {imageSrc(item.image) && (
                          <img
                            src={imageSrc(item.image)}
                            alt="Vista previa"
                            className="block size-full max-w-full object-contain"
                          />
                        )}
                      </div>
                      <div className="space-y-2">
                        <input
                          className={field}
                          value={item.image}
                          onChange={(event) => updateItem({ image: event.target.value })}
                          aria-label="Ruta o URL de la imagen"
                        />
                        <label className="inline-flex cursor-pointer items-center rounded-full border border-white/15 px-4 py-2 text-sm text-cream-dim hover:border-ember/50 hover:text-cream">
                          {uploading ? "Subiendo…" : "Subir imagen"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="sr-only"
                            disabled={uploading}
                            onChange={(event) => {
                              void uploadImage(event.target.files?.[0]);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-cream-dim">
                    <input
                      type="checkbox"
                      checked={item.enabled !== false}
                      onChange={(event) => updateItem({ enabled: event.target.checked })}
                      className="size-4 accent-ember"
                    />{" "}
                    Visible en la página
                  </label>
                  <label className="flex items-center gap-2 text-sm text-cream-dim">
                    <input
                      type="checkbox"
                      checked={Boolean(item.tagHot)}
                      onChange={(event) => updateItem({ tagHot: event.target.checked })}
                      className="size-4 accent-ember"
                    />{" "}
                    Destacar etiqueta
                  </label>
                  <label className="flex items-center gap-2 text-sm text-cream-dim">
                    <input
                      type="checkbox"
                      checked={Boolean(item.sauces)}
                      onChange={(event) =>
                        updateItem({
                          sauces: event.target.checked,
                          sauceOptions: item.sauceOptions ?? DEFAULT_SAUCES,
                        })
                      }
                      className="size-4 accent-ember"
                    />{" "}
                    Permitir elegir salsa
                  </label>

                  {item.sauces && (
                    <label className="sm:col-span-2">
                      <span className={label}>Opciones de salsa, una por línea</span>
                      <textarea
                        className={field}
                        rows={3}
                        value={(item.sauceOptions ?? DEFAULT_SAUCES).join("\n")}
                        onChange={(event) =>
                          updateItem({
                            sauceOptions: event.target.value
                              .split(/\r?\n/)
                              .map((value) => value.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>
                  )}

                  {item.category === "promos" && (
                    <fieldset className="sm:col-span-2">
                      <legend className={label}>Días en que se destaca</legend>
                      <div className="flex flex-wrap gap-2">
                        {weekdays.map(({ day, label: dayLabel }) => (
                          <label
                            key={day}
                            className={`cursor-pointer rounded-full px-3 py-1.5 text-xs ${item.promoDays?.includes(day) ? "bg-ember text-ink" : "ring-1 ring-white/15 text-cream-dim"}`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={item.promoDays?.includes(day) ?? false}
                              onChange={(event) => {
                                const days = new Set(item.promoDays ?? []);
                                if (event.target.checked) days.add(day);
                                else days.delete(day);
                                updateItem({ promoDays: [...days] });
                              }}
                            />
                            {dayLabel}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>

                <div className="mt-8 border-t border-white/10 pt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-display text-2xl">Variantes</h2>
                    <button
                      onClick={() =>
                        updateItem({
                          variants: [
                            ...(item.variants ?? []),
                            { label: "Nueva", name: item.name, desc: item.desc, image: item.image },
                          ],
                        })
                      }
                      className="text-sm text-ember hover:text-cream"
                    >
                      ＋ Agregar variante
                    </button>
                  </div>
                  <div className="space-y-4">
                    {(item.variants ?? []).map((variant, index) => (
                      <div
                        key={index}
                        className="grid gap-3 border-b border-white/10 pb-4 sm:grid-cols-2"
                      >
                        <label>
                          <span className={label}>Etiqueta</span>
                          <input
                            className={field}
                            value={variant.label}
                            onChange={(event) =>
                              updateVariant(index, { label: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          <span className={label}>Nombre para el pedido</span>
                          <input
                            className={field}
                            value={variant.name}
                            onChange={(event) => updateVariant(index, { name: event.target.value })}
                          />
                        </label>
                        <label>
                          <span className={label}>Descripción</span>
                          <input
                            className={field}
                            value={variant.desc}
                            onChange={(event) => updateVariant(index, { desc: event.target.value })}
                          />
                        </label>
                        <label>
                          <span className={label}>Precio de variante (ARS)</span>
                          <input
                            className={field}
                            type="number"
                            min="0"
                            value={variant.price ?? ""}
                            onChange={(event) =>
                              updateVariant(index, {
                                price:
                                  event.target.value === ""
                                    ? undefined
                                    : Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          <span className={label}>Imagen (ruta o URL)</span>
                          <input
                            className={field}
                            value={variant.image}
                            onChange={(event) =>
                              updateVariant(index, { image: event.target.value })
                            }
                          />
                        </label>
                        <button
                          onClick={() =>
                            updateItem({
                              variants: item.variants?.filter(
                                (_, variantIndex) => variantIndex !== index,
                              ),
                            })
                          }
                          className="justify-self-start text-sm text-cream-dim hover:text-ember"
                        >
                          Quitar variante
                        </button>
                      </div>
                    ))}
                    {(item.variants?.length ?? 0) === 0 && (
                      <p className="text-sm text-cream-dim">Este producto no tiene variantes.</p>
                    )}
                  </div>
                </div>

                <div className="mt-8 border-t border-white/10 pt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-display text-2xl">Adicionales</h2>
                    <button
                      onClick={() =>
                        updateItem({
                          extras: [...(item.extras ?? []), { label: "Nuevo adicional", price: 0 }],
                        })
                      }
                      className="text-sm text-ember hover:text-cream"
                    >
                      ＋ Agregar adicional
                    </button>
                  </div>
                  <div className="space-y-2">
                    {(item.extras ?? []).map((extra, index) => (
                      <div
                        key={index}
                        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]"
                      >
                        <input
                          className={field}
                          aria-label="Nombre del adicional"
                          value={extra.label}
                          onChange={(event) =>
                            updateItem({
                              extras: item.extras?.map((entry, extraIndex) =>
                                extraIndex === index
                                  ? { ...entry, label: event.target.value }
                                  : entry,
                              ),
                            })
                          }
                        />
                        <input
                          className={field}
                          aria-label="Precio del adicional"
                          type="number"
                          min="0"
                          value={extra.price ?? ""}
                          onChange={(event) =>
                            updateItem({
                              extras: item.extras?.map((entry, extraIndex) =>
                                extraIndex === index
                                  ? ({
                                      ...entry,
                                      price:
                                        event.target.value === ""
                                          ? undefined
                                          : Number(event.target.value),
                                    } as MenuExtra)
                                  : entry,
                              ),
                            })
                          }
                        />
                        <button
                          aria-label={`Quitar ${extra.label}`}
                          onClick={() =>
                            updateItem({
                              extras: item.extras?.filter((_, extraIndex) => extraIndex !== index),
                            })
                          }
                          className="px-2 text-cream-dim hover:text-ember"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {(item.extras?.length ?? 0) === 0 && (
                      <p className="text-sm text-cream-dim">Este producto no tiene adicionales.</p>
                    )}
                  </div>
                </div>

                <button
                  onClick={removeItem}
                  className="mt-8 rounded-full border border-red-400/40 px-4 py-2 text-sm text-red-300 hover:bg-red-400/10"
                >
                  Eliminar producto
                </button>
              </section>
            ) : (
              <p className="text-cream-dim">No hay productos en esta categoría.</p>
            )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
