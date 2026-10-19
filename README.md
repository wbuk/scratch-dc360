# scratch-dc360

Builds of the [Scratch editor](https://github.com/scratchfoundation/scratch-editor) for the Scratch app on
Deliver Computing 360 (DC360).

Scratch publishes its releases as source code only. Every night `.github/workflows/build.yml` checks for a new
Scratch release, builds it with Scratch's own build (`npm ci` + `npm run build`) and publishes
`packages/scratch-gui/build` here as a release with the same tag (for example `v15.2.0`), as
**scratch-dc360.zip**. The zip also holds `assets.txt`: every library picture and sound the editor uses.

DC360 Libraries (Libraries > Apps on DC360) checks these releases, downloads the zip and applies DC360's own
changes on the DC360 server before a DC360 admin switches it live. Those changes are published here in
**`dc360/`** (the change recipe and the DC360 scripts), so the source of the changed editor is available as the
GNU Affero General Public License asks.

Scratch is a project of the Scratch Foundation, licensed under the
**GNU Affero General Public License v3** (LICENSE.txt in each zip). "Scratch" and the Scratch Cat are
trademarks of the Scratch Foundation; DC360 is not made or endorsed by the Scratch Foundation.
