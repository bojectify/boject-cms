# Content Creation

Add the ability to create new content items from the CMS UI. Covers 9 content models with POST endpoints: Team, Club, Competition, Season, Player, Fixture, Author, Tag, Article. Excluded: Position and Score (no publishing metadata; managed inline in context). Images are excluded — they use the existing `POST /api/images/upload` multipart endpoint.

## Approach

Dual-mode `[id]` pages. When `id === 'new'`, the existing edit page switches to creation mode. No new page components are needed.

## API: POST Endpoints

One POST endpoint per model at `server/api/{model}/index.post.ts`.

### Behaviour

1. Read request body.
2. Validate required fields are present — return 400 if missing. Validate `slug` is present and non-empty — return 400 if missing (the client always sends it via the auto-slug watcher, but the API must enforce it independently).
3. Build a Prisma `create` data object from an explicit field allow-list (same fields as the corresponding PUT endpoint).
4. Call `applyContentMetadata(body, data, null)` for entryTitle, slug, and status handling. The third argument is `null` because there is no existing record. If status is not provided in the body, the Prisma schema `@default(DRAFT)` applies.
5. Run `prisma.{model}.create()` with the data. Include relations where the PUT endpoint does (e.g. `include: { socialLinks: true }` for authors, `include: { author: true, tags: true, featuredImage: true }` for articles).
6. Set response status to 201 via `setResponseStatus(event, 201)` and return the created item.
7. Catch unique constraint errors and return 409, same as PUT endpoints.

### Model-specific notes

- **Authors**: Accept `socialLinks` array. Use `createMany` nested write within the create call (no transaction needed since it's a single create operation).
- **Articles**: Accept `tagIds` array. Use `tags: { connect: tagIds.map(id => ({ id })) }` in the create call. Accept `body` as `InputJsonValue`.
- **Fixtures**: Accept relation IDs (`teamId`, `opponentId`, `competitionId`, `seasonId`) and `isHome` boolean.
- **Players**: Accept `firstName`, `lastName`, `bio`, `positionId`.
- **Images**: No POST creation endpoint — images use the existing `POST /api/images/upload` multipart endpoint. The image edit page (`pages/images/[id].vue`) will not get a "new" mode. If a user navigates to `/images/new` directly, the page redirects to `/images`.

### Required fields per model

POST endpoints must validate these required fields are present (return 400 if missing). All models also require `slug` and `entryTitle`.

| Model       | Required fields                |
| ----------- | ------------------------------ |
| Team        | `name`                         |
| Club        | `name`                         |
| Competition | `name`                         |
| Season      | `name`, `startDate`, `endDate` |
| Player      | `firstName`, `lastName`        |
| Fixture     | `name`, `kickoff`              |
| Author      | `name`                         |
| Tag         | `name`                         |
| Article     | `title`                        |

## Composable: useContentEditor

Extend the existing composable to support create mode.

### Changes

```typescript
export function useContentEditor(modelPath: string, id: string) {
  const isNew = id === 'new';
```

**When `isNew` is true:**

- Skip `useFetch` — no item to fetch. Set `loadingStatus` to `'success'` equivalent (not pending).
- Initialise `formState` with defaults synchronously (before the template renders): `Object.assign(formState, { status: 'DRAFT' })`. This must happen synchronously in setup so that `UForm` captures the correct initial state for dirty tracking.
- `save()` sends `POST /api/{modelPath}` instead of `PUT /api/{modelPath}/{id}`.
- On successful POST, return the created item's `id` so the calling page can redirect.
- Toast message changes to "Created" / "Content created successfully."

**When `isNew` is false:**

- Behaviour unchanged (fetch + PUT).

### Updated return type

`save()` returns `Promise<string | void>` — returns the new item's `id` on create, `void` on update.

## Pages: Dual-mode [id].vue

Each `pages/{model}/[id].vue` page detects create mode and adjusts.

### Changes per page

1. Derive `isNew` from the route param:

   ```typescript
   const id = route.params.id as string;
   const isNew = id === 'new';
   ```

2. Pass `id` to `useContentEditor` as before (it handles the `'new'` case internally).

3. Dynamic page title:

   ```typescript
   const pageTitle = isNew ? 'New Team' : 'Edit Team';
   ```

4. Wrap the save call to handle redirect on create:

   ```typescript
   async function handleSave() {
     const newId = await save();
     if (newId) {
       await navigateTo(`/teams/${newId}`);
     }
   }
   ```

   Note: `navigateTo` causes a full route change (different `id` param), so the `[id].vue` component re-runs `<script setup>` with the real UUID and `useContentEditor` initialises in edit mode. No stale state.

5. Pass `handleSave` instead of `save` to `ContentEditor`'s `onSave` prop.

6. Slug/entryTitle watchers: these already work reactively and need no changes. On a new item, `formState.name` starts empty; when the user types, the watcher fires and sets `entryTitle` and `slug`.

7. For articles: the `tags` → `tagIds` watcher should be guarded so it doesn't run in create mode (there's no `tags` array from the API to map):
   ```typescript
   watch(
     () => formState.tags,
     (tags) => {
       if (!isNew && Array.isArray(tags)) {
         formState.tagIds = tags.map((t) => t.id);
       }
     },
     { immediate: true }
   );
   ```

### ContentEditor component

No changes needed. It already accepts `state` and `fields` generically. The Save button's `:disabled="!form?.dirty"` check works correctly for new items: the composable sets `{ status: 'DRAFT' }` synchronously, UForm captures that as the initial snapshot, and any user input (typing a name, which triggers the slug/entryTitle watchers) makes the form dirty.

### Images exception

The images listing page links to `/images/new` would not make sense since images are created via upload. Instead, the images listing page gets an "Upload Image" button that triggers the existing upload flow (or navigates to an upload page). This is a separate concern from the content creation feature and can be handled later. For now, the images listing page simply won't have a "New" button.

## Listing Pages: Create Button

Each `pages/{model}/index.vue` gets a "New {Model}" button in the page header.

### Implementation

The `ContentTable` component currently renders the title in a plain `<h1>`. The listing pages don't use `UDashboardNavbar` directly — the title and table are all inside ContentTable.

Add a `#actions` slot to `ContentTable` that renders next to the title:

```vue
<!-- ContentTable.vue -->
<div class="flex items-center justify-between mb-4">
  <h1 class="text-2xl font-bold">{{ title }}</h1>
  <slot name="actions" />
</div>
```

Each listing page passes a create button via the slot:

```vue
<!-- pages/teams/index.vue -->
<ContentTable ...>
  <template #actions>
    <UButton to="/teams/new" icon="i-lucide-plus">New Team</UButton>
  </template>
</ContentTable>
```

Images listing page: no create button (uses existing upload flow).

## Testing

Add integration tests for each new POST endpoint, colocated with existing test files.

### Test cases per model

1. **Validation**: POST with missing required fields returns 400.
2. **Successful create**: POST with valid data returns 201 with the created item including `id`, default status `DRAFT`, and timestamps.
3. **Unique constraint**: POST with a duplicate name/slug returns 409.
4. **Relations** (where applicable): Created item includes resolved relations (e.g. author's socialLinks, article's tags).

### Test data strategy

Tests should use unique names with timestamps or random suffixes (e.g. `Test Team ${Date.now()}`) to avoid unique constraint conflicts across test runs. This matches the existing test patterns which modify seeded data in place without cleanup.

### Test file locations

Add to existing test files where they exist (authors, tags, articles), create new colocated test files for models that don't have them yet.

## Summary of files to create/modify

### New files (9 POST endpoints)

- `server/api/teams/index.post.ts`
- `server/api/clubs/index.post.ts`
- `server/api/competitions/index.post.ts`
- `server/api/seasons/index.post.ts`
- `server/api/players/index.post.ts`
- `server/api/fixtures/index.post.ts`
- `server/api/authors/index.post.ts`
- `server/api/tags/index.post.ts`
- `server/api/articles/index.post.ts`

### Modified files

- `composables/useContentEditor.ts` — create mode support
- `components/ContentTable.vue` — add `#actions` slot
- `pages/teams/[id].vue` — dual-mode + redirect
- `pages/clubs/[id].vue` — dual-mode + redirect
- `pages/competitions/[id].vue` — dual-mode + redirect
- `pages/seasons/[id].vue` — dual-mode + redirect
- `pages/players/[id].vue` — dual-mode + redirect
- `pages/fixtures/[id].vue` — dual-mode + redirect
- `pages/authors/[id].vue` — dual-mode + redirect
- `pages/tags/[id].vue` — dual-mode + redirect
- `pages/articles/[id].vue` — dual-mode + redirect
- `pages/images/[id].vue` — redirect `/images/new` to `/images`
- `pages/teams/index.vue` — create button
- `pages/clubs/index.vue` — create button
- `pages/competitions/index.vue` — create button
- `pages/seasons/index.vue` — create button
- `pages/players/index.vue` — create button
- `pages/fixtures/index.vue` — create button
- `pages/authors/index.vue` — create button
- `pages/tags/index.vue` — create button
- `pages/articles/index.vue` — create button
