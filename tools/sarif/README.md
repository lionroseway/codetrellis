# SARIF 2.1.0 schema

`sarif-schema-2.1.0.json` is the SARIF 2.1.0 JSON schema (the OASIS
standard, errata 01) in its draft-07 form, as published by SchemaStore.
`src/cli/sarif.test.ts` validates the gate's SARIF against it, so the output
`codetrellis check --format sarif` writes is checked against the standard,
not against our idea of it.

| | |
|---|---|
| Source | https://json.schemastore.org/sarif-2.1.0.json |
| `$id` | https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json |
| sha256 | `c96eb2d311c37b0a38cbd18c52d79a68f778bbd2d831abed7412d9850740f785` |
| Fetched | 2026-10-06 |

Replace it only with the same standard's schema, and update the row.
