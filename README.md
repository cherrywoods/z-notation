# Z Specification Language — interactive tutorial

A small website for learning the Z notation by writing a specification of a
safety-critical system step by step: types, state, operations, initial state.
While you edit, it shows example states and operation runs ("testing the spec"),
facts that follow from the spec with their derivation, and explanations of every symbol.

## Run locally

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Z engine, generator, inference, editor)
npm run build    # static site in dist/
```

## Publish on GitHub Pages

1. Push this repository to GitHub.
2. In the repository settings, under **Pages → Build and deployment**, choose **GitHub Actions**.
3. Every push to `main` builds and deploys the site (`.github/workflows/deploy.yml`).

The site uses relative paths and hash routing, so it works under any
`https://<user>.github.io/<repo>/` address without configuration.

## Adding or changing a system

Each system on the start page is one file in `templates/` (format: `docs/design.md`,
section "Template format"). Lines marked `"hidden": true` are left for students to write;
the schema's `prompt` tells them what is missing. `fixedValues` gives realistic example
data for fixed tables (e.g. blood-type compatibility).

## Hidden presentation mode

Press `p` on the start page (or click the faint QR icon in the corner, or open `#/present`)
to show a large QR code and the address, so late students can join. `Esc` closes it.
