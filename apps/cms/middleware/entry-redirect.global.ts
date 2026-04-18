export default defineNuxtRouteMiddleware((to) => {
  // /content-types/:id/entries/new -> /entries/new:<id>
  const newMatch = to.path.match(/^\/content-types\/([^/]+)\/entries\/new\/?$/);
  if (newMatch) {
    return navigateTo(`/entries/new:${newMatch[1]}`, { replace: true });
  }

  // /content-types/:id/entries/:entryId -> /entries/:entryId
  const editMatch = to.path.match(
    /^\/content-types\/[^/]+\/entries\/([^/]+)\/?$/
  );
  if (editMatch) {
    return navigateTo(`/entries/${editMatch[1]}`, { replace: true });
  }
});
