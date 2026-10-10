# Changesets

Each file here says which packages a pull request changes and how (`patch`, `minor`, `major`), with a line for their
changelogs. `pnpm changeset` writes one; the release workflow turns them into a "Version packages" pull request,
and merging that publishes `openfilm` and `@openfilm/shared` to npm. `@openfilm/desktop` is versioned here too but
never published to npm: its installers are released with a `desktop-v<version>` tag. See CONTRIBUTING.md, Releases.
