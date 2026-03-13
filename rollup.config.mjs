import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

/** @type {import('rollup').RollupOptions} */
export default {
  input: "src/plugin.ts",
  output: {
    file: "com.gameaday.mediamaid.sdPlugin/bin/plugin.js",
    format: "cjs",
    sourcemap: true,
    exports: "auto"
  },
  external: ["fs", "fs/promises", "path", "os", "child_process", "crypto"],
  plugins: [
    nodeResolve({ browser: false, preferBuiltins: true }),
    typescript({ tsconfig: "./tsconfig.json" }),
    commonjs()
  ]
};
