## Specification

Build a Typescript React app that can be statically deployed (running on the client/browser only). Use material UI components, material icons and Tailwind classes for all CSS styling to implement UI.

- /src/main.tsx contains the main UI component. It has a page header with the XmlLoader element at the very top, beneath it is the ModelViewer, which has its own internal layout.
  - /src/components/XmlLoader.tsx
  - /src/components/modelviewer.tsx has 3 child components, arranged in the following layout: The GraphViewer and SparqlConfig are next to each other and have the same width, if the screen size allows it, otherwise the SparqlConfig wraps over to the next line. At the bottom is the SparqlResults component, which always spans the entire width of the ModelViewer, no matter how the top two components are arranged.
  - /src/components/modelviewer/graphviewer.tsx
  - /src/components/modelviewer/sparqlconfig.tsx
  - /src/components/modelviewer/sparqlresults.tsx
- /src/serializer/ contains files that are used for serializing.
  - /src/serializer/ast.ts contains unist node definition
  - /src/serializer/sparql.ts contains
  - /src/serializer/pydantic.ts contains
- /src/pathbuilder.ts contains functions for parsing XML files such as the one found in the /public folder.
- /src/state.ts contains . It also contains a reducer function for the state object, which will be used by useReducer() from the main React app component. The reducer function should implement the following actions:
  - 'toggle_expand_up':
  - 'toggle_expand_down':
  - 'select_node':
  - 'unselect_node':
  - one 'set\_...' action for every string, number or boolean field in the state object
- /src/state/url.ts should contain code for serializing the current model state into the page's query parameters, and for initiating the page's global state from the query parameters when first landing on the page. Default values of the state object should be omitted from query parameter serialization.
- /src/state/localstorage.ts should contain code for writing state objects to the browser's localstorage under some unique string reference. It should also contain code for loading those state objects back from localstorage.

## Code style

- Follow ESLint/Stylelint rules from @acdh-oeaw configs; rely on oxfmt for formatting.
- Indentation and formatting are enforced by tooling
