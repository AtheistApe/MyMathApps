# Parametric Curve Explorer

Interactive visualization for Math 252 (Second Semester Calculus) showing the relationship between a parametric curve (x(t), y(t)) and its component functions x(t) and y(t).

## Features
- Synchronized graphs: y(t) vs t, x(t) vs t, and the parametric xy-plane
- Dashed projection lines connecting component graphs to the curve
- Slider and keyboard (← →) control for the parameter t
- Animation mode
- Custom expressions with full math function support (sin, cos, sqrt, log, exp, etc.)

## Development
```bash
npm install
npm run dev
```

## Deploy
```bash
npm run build
```
Upload the `dist/` folder to Netlify, Vercel, or any static host.
