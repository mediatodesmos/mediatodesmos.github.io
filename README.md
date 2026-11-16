# Media to Desmos

Turn any PNG or MP4 into a black-and-white [Desmos](https://www.desmos.com/calculator) graph, right in your browser.

**Live site:** https://mediatodesmos.github.io

- **Images:** PNG, JPG, WebP, GIF (first frame), BMP and SVG are traced into equations.
- **Videos:** MP4, WebM and MOV become *one* Desmos graph. A frame slider `F` picks the frame, and a ticker plays the clip.
- **Three drawing styles:**
  - Outline: cubic Bezier curves.
  - Fill: polygons with real holes.
  - Fourier: each outline becomes a sum of spinning circles.
- **Every equation explained:** the inspector lists each expression, says what it draws, and highlights it on the graph and on the source image.
- **Mass export to desmos.com:**
  - One-click bookmarklet
  - Console snippet
  - JSON file
  - Plain LaTeX lines
- **Live webcam mode, saved projects and share links.**
- **Private:** nothing is uploaded. Tracing runs in Web Workers on your device.

## How it works

1. **Analyze:** the file is decoded and scaled to a working resolution. Transparent pixels are composited over white, and Otsu's method picks an automatic threshold from the luminance histogram.
2. **Trace:**
   - Outline mode runs Canny edge detection, then Zhang-Suen thinning, and links the edge pixels into chains.
   - Fill and Fourier modes run marching squares, which gives sub-pixel contours with holes.
3. **Fit:**
   - Chains become cubic Beziers through Schneider's least-squares fitting, with corner detection.
   - Contours become polygons. Holes are joined to the outline by zero-width bridges, so the nonzero fill rule cuts them out.
   - In Fourier mode, a discrete Fourier transform keeps the biggest circles.
4. **Write Desmos:**
   - Coordinates are packed into lists, and one broadcast equation draws a whole shape.
   - Video frames are concatenated into chunks under Desmos' 10,000-item list limit, and `X[U[F]...V[F]]` slices out the current frame.

## Develop

```bash
npm install
npm run dev      # http://localhost:5180
npm test         # unit tests (pipeline + Desmos builders)
npm run build    # static site in dist/
```

## Desmos API key

The calculator embed uses the Desmos API v1.12. Development uses Desmos' public demo key. For production, request a key at https://www.desmos.com/my-api, then add it as the repository **variable** `DESMOS_API_KEY` (Settings > Secrets and variables > Actions > Variables). The deploy workflow passes it to the build as `VITE_DESMOS_API_KEY`.

## Deploy

Every push to `main` runs the tests, builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`).

## Credits

- Design language adapted from the Vertex landing page. Icons are custom SVG.
- Not affiliated with or endorsed by Desmos Studio PBC.

MIT licensed.
