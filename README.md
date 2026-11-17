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

Each system on the start page is one file in `templates/` (format: `docs/design.md`).
Students start with empty schemas. The template's schema lines are the hidden reference
spec that the step `goals` are checked against (independently of variable names);
`card` is the text of the System tab, `typeOptions` lists extra types offered on the
Types step, and `fixedValues` gives realistic fixed data (e.g. blood-type compatibility).

## Hidden presenter mode

Click the faint QR icon in a corner of the start page to switch presenter mode on: every
page then shows a footer with a QR code and the address, so late students can join, and
the Z text gets larger for the projector. Hover the footer and click ✕ to switch it off.
