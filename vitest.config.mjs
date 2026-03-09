import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    define: {
      __DEFAULT_XML__: JSON.stringify(env.DEFAULT_XML ?? ""),
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.ts"],
    },
  };
});
