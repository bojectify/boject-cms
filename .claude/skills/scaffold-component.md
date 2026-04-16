---
name: scaffold-component
description: Scaffold a new Vue component with the project's standard directory structure (kebab-case dir, PascalCase .vue, camelCase .config.ts + .types.ts, data-testid wiring)
user_invocable: true
---

# Scaffold Component

Creates a new component following the project's component directory convention.

## Arguments

The user provides a component name in any casing (e.g. "MyWidget", "my-widget", "myWidget"). Parse it into:

- **kebab-case** for the directory name: `components/{kebab-case}/`
- **PascalCase** for the `.vue` filename: `{PascalCase}.vue`
- **camelCase** for the `.config.ts` and `.types.ts` filenames: `{camelCase}.config.ts`, `{camelCase}.types.ts`
- **SCREAMING_SNAKE_CASE** for the QA constant: `QA_{SCREAMING_SNAKE}`

## Files to create

### 1. `components/{kebab-case}/{camelCase}.config.ts`

```ts
import { testIds } from '~/utils/test-config/testConfig.utils';

export const QA_{SCREAMING_SNAKE} = {
  ...testIds('{SCREAMING_SNAKE}'),
};
```

### 2. `components/{kebab-case}/{camelCase}.types.ts`

```ts
import type { BasicComponentProps } from '~/types/basicComponentProps';

export type {PascalCase}Props = BasicComponentProps & {
  // Add component-specific props here
};
```

### 3. `components/{kebab-case}/{PascalCase}.vue`

```vue
<script setup lang="ts">
import type { {PascalCase}Props } from './{camelCase}.types';
import { QA_{SCREAMING_SNAKE} } from './{camelCase}.config';

const props = withDefaults(defineProps<{PascalCase}Props>(), {
  testId: QA_{SCREAMING_SNAKE}.COMPONENT,
});
</script>

<template>
  <div :data-testid="testId">
    <!-- {PascalCase} -->
  </div>
</template>
```

## Checklist

1. Parse the component name into all four casing variants
2. Verify `components/{kebab-case}/` does not already exist
3. Create all three files using the templates above
4. Report the created file paths to the user

## Notes

- The `pathPrefix: false` setting in `nuxt.config.ts` means Nuxt resolves component names from the filename, not the directory — so `components/my-widget/MyWidget.vue` auto-registers as `<MyWidget>`.
- The `testId` prop comes from `BasicComponentProps` and is wired to the root element via `:data-testid="testId"`.
- The default `testId` value is derived from the `QA_` config constant's `.COMPONENT` property, which produces a kebab-case string via `testIds()`.
