import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const configuredBase = env.VITE_BASE_PATH?.trim();
  const base = configuredBase != null && configuredBase.length > 0 ? configuredBase : "./";

  return {
    base,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }

            if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) {
              return "vendor-react";
            }

            if (id.includes("/node_modules/@mui/") || id.includes("/node_modules/@emotion/")) {
              return "vendor-mui";
            }

            if (id.includes("/node_modules/@xyflow/")) {
              return "vendor-xyflow";
            }

            if (id.includes("/node_modules/shiki/") || id.includes("/node_modules/@shikijs/")) {
              return "vendor-shiki";
            }

            if (id.includes("/node_modules/sparqljs/")) {
              return "vendor-sparql";
            }

            return undefined;
          },
        },
      },
    },
    define: {
      __DEFAULT_XML__: JSON.stringify(env.DEFAULT_XML ?? ""),
    },
  };
});
