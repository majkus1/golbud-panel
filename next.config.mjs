import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname
  },
  /**
   * Bez tego Next/Turbopack potrafi zbundlować @react-pdf tak, że reconciler
   * widzi „obcy” element Reacta → Minified React error #31 przy renderToBuffer
   * w Route Handlerach (nawet przy minimalnym <Document>).
   * @see https://github.com/diegomura/react-pdf/issues/2976
   */
  serverExternalPackages: [
    "@react-pdf/renderer",
    "@react-pdf/reconciler",
    "@react-pdf/render",
    "@react-pdf/layout",
    "@react-pdf/pdfkit",
    "@react-pdf/font",
    "@react-pdf/primitives",
    "@react-pdf/stylesheet",
    "@react-pdf/image",
    "@react-pdf/fns",
    "web-push"
  ],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" }
        ]
      }
    ];
  }
};

export default nextConfig;
