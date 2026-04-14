# Releven Model Explorer

Releven Model Explorer is a browser-based tool for exploring Pathbuilder XML models, selecting nodes in the graph, and generating SPARQL queries and Python/Pydantic model skeletons from those selections. The web UI also lets you load saved scenarios, inspect root classes, and run the generated SPARQL against an endpoint.

Current limitation: the SPARQL config option `omit path prefixes unless explicitly selected` is present in the UI and scenario state, but is not implemented yet in the serializers.

## Web App

Start the local app with:

```bash
pnpm dev
```

The deployed app is available at <https://erc-releven.github.io/model-explorer/>.

## CLI

The CLI reads a Pathbuilder XML file plus one or more scenario JSON files and prints serialized SPARQL. Scenario files can be either a raw `Scenario` object or an object of the form `{ "name": "...", "scenario": { ... } }`.

Run the CLI with:

```bash
pnpm run cli -- --xml public/releven_expanded_20251216.xml --scenario /path/to/scenario.json
```

Generate one scenario for every root type in the XML:

```bash
pnpm run cli -- --xml public/releven_expanded_20251216.xml --root-types
```

Write one `.rq` query file and one `.py` model file per scenario:

```bash
pnpm run cli -- --xml public/releven_expanded_20251216.xml --root-types --output files --output-dir ./generated
```

Execute the generated query against a SPARQL endpoint:

```bash
pnpm run cli -- --xml public/releven_expanded_20251216.xml --scenario /path/to/scenario.json --execute --endpoint https://example.org/sparql
```
