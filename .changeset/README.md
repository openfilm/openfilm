# Changesets

Each file here says which packages a pull request changes and how (`patch`, `minor`, `major`), with a line for the
changelog. `pnpm changeset` writes one; the release workflow turns them into a "Version packages" pull request, and
merging that publishes `openfilm` to npm. All the packages share one version (`fixed` in config.json); the desktop
app is released from the tag `v<version>`. See CONTRIBUTING.md, Releases.
