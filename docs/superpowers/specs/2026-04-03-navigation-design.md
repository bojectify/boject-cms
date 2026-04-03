# Navigation & Link Models Design

## Overview

CMS-managed navigation for consuming applications (website/app). Editors control the navigation structure and links from the CMS, and clients fetch the data via the GraphQL API.

The rugby domain models serve as data showcase — the consuming site won't have fixture/team/player pages. Linkable content types are currently limited to Article, with more page-type models coming (HomePage, Video, Packages, Quizzes, etc.).

## Data Models

### Link

Standalone, reusable content model. Can be used in navigation, rich text embeds, or anywhere a link is needed. Has content metadata (status, entryTitle) but no slug.

```prisma
model Link {
  id              String           @id @default(uuid())
  entryTitle      String           @default("")
  label           String
  url             String?
  article         Article?         @relation(fields: [articleId], references: [id], onDelete: SetNull)
  articleId       String?
  openInNewTab    Boolean          @default(false)
  navigationItems NavigationItem[]
  status          ContentStatus    @default(DRAFT)
  publishedAt     DateTime?
  createdBy       String?
  updatedBy       String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
}
```

**Validation:** A Link must have either `url` or `articleId` (or both), but not neither. Enforced at the API level, not the DB level.

**Future content references:** When new linkable types are added (Video, HomePage, etc.), add nullable FK fields (e.g. `videoId`, `homePageId`) following the same pattern as `articleId`. Each addition requires a schema migration.

### NavigationItem

Structural join model — no content metadata of its own. Handles ordering and nesting within a Navigation.

```prisma
model NavigationItem {
  id           String           @id @default(uuid())
  order        Int              @default(0)
  link         Link             @relation(fields: [linkId], references: [id], onDelete: Cascade)
  linkId       String
  navigation   Navigation       @relation(fields: [navigationId], references: [id], onDelete: Cascade)
  navigationId String
  parent       NavigationItem?  @relation("NavigationItemChildren", fields: [parentId], references: [id], onDelete: Cascade)
  parentId     String?
  children     NavigationItem[] @relation("NavigationItemChildren")
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
}
```

- Top-level items: `parentId` is null.
- Sub-links: `parentId` points to a top-level item.
- Strictly two levels deep — enforced at the API level (reject items where the parent itself has a parent).

### Navigation

Container for a set of NavigationItems. Currently a single entry ("Main Navigation"), but the model supports multiple named navigations if needed later.

```prisma
model Navigation {
  id          String           @id @default(uuid())
  entryTitle  String           @default("")
  name        String           @unique
  items       NavigationItem[]
  status      ContentStatus    @default(DRAFT)
  publishedAt DateTime?
  createdBy   String?
  updatedBy   String?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
}
```

## REST API

### Link endpoints

| Method | Path                 | Description                                 |
| ------ | -------------------- | ------------------------------------------- |
| GET    | `/api/links`         | Paginated list, filterable by `status`      |
| GET    | `/api/links/[id]`    | Single link with article relation           |
| POST   | `/api/links`         | Create new link                             |
| PUT    | `/api/links/[id]`    | Update link fields + content metadata       |
| GET    | `/api/links/options` | `{ label, value }[]` for relation dropdowns |

### Navigation endpoints

| Method | Path                    | Description                                                                                                                  |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/navigations`      | List all navigations                                                                                                         |
| GET    | `/api/navigations/[id]` | Single navigation with nested items (each including link + article). Items ordered by `order`, children nested under parents |
| PUT    | `/api/navigations/[id]` | Update name + content metadata                                                                                               |

### NavigationItem endpoints

| Method | Path                                     | Description                                                                   |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/navigation-items?navigationId=xxx` | List items for a navigation, ordered                                          |
| POST   | `/api/navigation-items`                  | Create item (requires `navigationId`, `linkId`, optional `parentId`, `order`) |
| PUT    | `/api/navigation-items/[id]`             | Update order, parentId, linkId                                                |
| DELETE | `/api/navigation-items/[id]`             | Remove item from navigation (does not delete the Link)                        |
| PUT    | `/api/navigation-items/reorder`          | Bulk update order values. Body: `{ items: [{ id, order, parentId }] }`        |

The reorder endpoint supports drag-and-drop reordering in the CMS UI.

**Two-level enforcement:** POST and PUT for navigation-items reject requests where the specified `parentId` refers to an item that itself has a parent.

## GraphQL API

### Type definitions

- **Link** — `prismaObject` with all fields. `article` as `t.relation()`. Content metadata via `contentMetadataFields()`.
- **NavigationItem** — `prismaObject` with `order`, `link` as `t.relation()`, `parent` as nullable `t.relation()`, `children` as `t.relatedConnection()` ordered by `order`.
- **Navigation** — `prismaObject` with `name`, `items` as `t.relatedConnection()` filtered to `parentId: null` and ordered by `order`. Content metadata.

### Root queries

- `links` — `t.prismaConnection()` with `LinkWhere` filter
- `link(id)` — single lookup
- `navigations` — `t.prismaConnection()` with `NavigationWhere` filter
- `navigation(id)` — single lookup

No root queries for NavigationItem — accessed through Navigation's `items` connection.

### Where filters

- `LinkWhere` — status filter, `articleId` relation filter
- `NavigationWhere` — status filter

### Example client query

```graphql
query {
  navigations(first: 1) {
    edges {
      node {
        name
        items(first: 50) {
          edges {
            node {
              order
              link {
                label
                url
                openInNewTab
                article {
                  slug
                  title
                }
              }
              children(first: 20) {
                edges {
                  node {
                    order
                    link {
                      label
                      url
                      openInNewTab
                      article {
                        slug
                        title
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## CMS Pages

### Link pages

- **`/links`** — Listing page using `ContentTable`. Columns: entryTitle, label, url (truncated), status. Standard pagination and status filtering.
- **`/links/[id]`** — Edit page using `ContentEditor`. Fields: `label` (text), `url` (text), `article` (relation, optionsEndpoint: `/api/articles/options`), `openInNewTab` (boolean). Publishing section with status but no slug.

### Navigation pages

- **`/navigations`** — Listing page showing navigation entries.
- **`/navigations/[id]`** — Edit page. Top section: name + content metadata via `ContentEditor`. Below: items manager showing two-level tree of NavigationItems. Each item displays its link's label with controls to reorder, nest/unnest, change linked Link, and remove. "Add Item" button to attach an existing Link.

### Sidebar additions

Add "Links" and "Navigations" to the sidebar navigation in `layouts/default.vue`.

### ContentEditor adaptation

Add a `showSlug` prop (default `true`) to `ContentEditor` so Link edit pages can hide the slug field.

## Content endpoint

Add `'Link'` and `'Navigation'` to the content UNION query in `server/api/content.get.ts` so they appear in the "All Content" listing.

## Seed Data

Add to `prisma/seed.ts`:

- Several Links: mix of URL-only, article-reference-only, and both
- One Navigation: "Main Navigation"
- NavigationItems: several top-level items and nested sub-links demonstrating the two-level structure

## Tests

Following existing colocated test patterns:

- **`server/api/links/links.test.ts`** — Link REST API integration tests: listing, pagination, status filter, single-item lookup (with article), create, update, 404 handling.
- **`server/api/navigations/navigations.test.ts`** — Navigation REST API tests: listing, single-item lookup (with nested items + links), update.
- **`server/api/navigation-items/navigation-items.test.ts`** — NavigationItem REST API tests: create, update, delete, reorder, two-level depth enforcement.
- **`server/api/graphql/graphql.test.ts`** — Add navigation/link queries with nested items, filtering.
