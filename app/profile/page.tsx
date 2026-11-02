"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { MenuPanel } from "@/components/MenuPanel"

// Stored item.category values. OUTERWEAR, not JACKETS — convex/migrations.ts
// renamed every jacket record, so filtering on "JACKETS" here matched nothing
// and the category always rendered empty.
type Category = "SHIRTS" | "PANTS" | "SHOES" | "OUTERWEAR" | "ACCESSORIES"

const categories: Category[] = ["SHIRTS", "PANTS", "SHOES", "OUTERWEAR", "ACCESSORIES"]

// Code prefixes are unchanged on purpose: "JK" is baked into every existing
// jacket's code (JK-01, JK-02…), and "SN" into every shoe's. Renaming a
// prefix would make newly added items disagree with the ones already saved.
const categoryPrefix: Record<Category, string> = {
  SHIRTS: "SH",
  PANTS: "PT",
  SHOES: "SN",
  OUTERWEAR: "JK",
  ACCESSORIES: "AC",
}

// Display-only rename, same map as app/page.tsx — SHOES stays the internal
// value, only the on-screen label reads FOOTWEAR.
const categoryDisplayNames: Partial<Record<Category, string>> = {
  SHOES: "FOOTWEAR",
}

function categoryDisplayName(category: Category): string {
  return categoryDisplayNames[category] ?? category
}

function HomePageContent() {
  const searchParams = useSearchParams()
  const categoryParam = searchParams.get("category") as Category | null

  const [activeCategory, setActiveCategory] = useState<Category>(
    categoryParam && categories.includes(categoryParam) ? categoryParam : "SHIRTS"
  )
  const [showAddForm, setShowAddForm] = useState(false)
  const [newItemName, setNewItemName] = useState("")
  const [newItemCategory, setNewItemCategory] = useState<Category>("SHIRTS")
  const [frontImageFile, setFrontImageFile] = useState<File | null>(null)
  const [backImageFile, setBackImageFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    if (categoryParam && categories.includes(categoryParam)) {
      setActiveCategory(categoryParam)
    }
  }, [categoryParam])

  const items = useQuery(api.items.getAllItems)
  const createItem = useMutation(api.items.createItem)
  const generateUploadUrl = useMutation(api.items.generateUploadUrl)
  const analyzeItem = useAction(api.analyze.analyzeItem)

  const visibleItems = (items ?? []).filter(
    (item) => item.category === activeCategory
  )

  async function uploadPhoto(file: File): Promise<any> {
    const uploadUrl = await generateUploadUrl()
    const result = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    })
    const { storageId } = await result.json()
    return storageId
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    setIsUploading(true)

    try {
      const frontImageId = frontImageFile ? await uploadPhoto(frontImageFile) : undefined
      const backImageId = backImageFile ? await uploadPhoto(backImageFile) : undefined

      const existingInCategory = (items ?? []).filter(
        (item) => item.category === newItemCategory
      ).length
      const nextNumber = String(existingInCategory + 1).padStart(2, "0")
      const code = `${categoryPrefix[newItemCategory]}-${nextNumber}`

      const newItemId = await createItem({
        category: newItemCategory,
        code,
        name: newItemName || undefined,
        frontImageId,
        backImageId,
      })

      setNewItemName("")
      setFrontImageFile(null)
      setBackImageFile(null)
      setShowAddForm(false)

      // Kick off AI analysis in the background — don't make the user wait for it
      if (frontImageId) {
        analyzeItem({ id: newItemId }).catch((err) => {
          console.error("Analysis failed:", err)
        })
      }
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <main className="min-h-screen bg-white text-black dark:bg-neutral-950 dark:text-white">
      {/* Top nav */}
      <header className="flex items-center justify-between border-b border-black/10 px-8 py-4 dark:border-white/10">
        {/* MenuPanel draws its hamburger as bg-black dark:bg-white. While this
            page was hardcoded bg-white, dark mode turned those two rules white
            on a white header and the button vanished — it was always mounted,
            just invisible. The dark: classes on <main> above are what make it
            show up again. */}
        <MenuPanel />

        <nav className="flex gap-6">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`text-xs tracking-widest ${
                category === activeCategory
                  ? "text-black font-medium dark:text-white"
                  : "text-black/30 dark:text-white/30"
              }`}
            >
              {categoryDisplayName(category)}
            </button>
          ))}
        </nav>

        <button
          onClick={() => setShowAddForm(true)}
          className="text-xs tracking-widest text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
        >
          + ADD ITEM
        </button>
      </header>

      {/* Item grid */}
      <section className="grid grid-cols-2 gap-x-10 gap-y-14 px-8 py-14 sm:grid-cols-3 md:grid-cols-6">
        {visibleItems.map((item) => (
          <Link
            key={item._id}
            href={`/item/${item._id}`}
            className="flex flex-col items-center gap-4"
          >
            <div className="flex aspect-square w-full items-center justify-center overflow-hidden bg-neutral-100 dark:bg-neutral-900">
              {item.frontImageUrl ? (
                <img
                  src={item.frontImageUrl}
                  alt={item.name ?? item.code}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs text-black/20 dark:text-white/20">
                  {categoryDisplayName(item.category as Category)}
                </span>
              )}
            </div>
            <span className="text-xs tracking-widest">{item.code}</span>
          </Link>
        ))}

        {items !== undefined && visibleItems.length === 0 && (
          <p className="col-span-full text-center text-sm text-black/40 dark:text-white/40">
            No {categoryDisplayName(activeCategory).toLowerCase()} yet. Click + to add
            one.
          </p>
        )}
      </section>

      {/* Add item modal */}
      {showAddForm && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/20">
          <form
            onSubmit={handleAddItem}
            className="flex w-80 flex-col gap-4 bg-white p-8 shadow-lg dark:bg-neutral-900"
          >
            <h2 className="text-xs tracking-widest">ADD ITEM</h2>

            <label className="flex flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
              CATEGORY
              <select
                value={newItemCategory}
                onChange={(e) => setNewItemCategory(e.target.value as Category)}
                className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {categoryDisplayName(category)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
              NAME (OPTIONAL)
              <input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="black oxford shirt"
                className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
              PHOTO (FRONT)
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFrontImageFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
              PHOTO (BACK, OPTIONAL)
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setBackImageFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isUploading}
                className="flex-1 bg-black py-2 text-xs tracking-widest text-white disabled:opacity-50 dark:bg-neutral-200 dark:text-black"
              >
                {isUploading ? "SAVING..." : "SAVE"}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="flex-1 border border-black/10 py-2 text-xs tracking-widest dark:border-white/10"
              >
                CANCEL
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageContent />
    </Suspense>
  )
}