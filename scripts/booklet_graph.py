# Small SVG grapher for booklet figures (white card, navy axes with arrows, tick
# labels, red curves, labelled points, dashed asymptotes). Used to draw the
# 12.MA Graphing Techniques homework figures; import it from a scratch script:
#   sys.path.insert(0, "scripts"); from booklet_graph import G, panels
import math, base64, html
FONT = "'Avenir Next', 'Helvetica Neue', Arial, sans-serif"
INK, RED, BLUE, GREY = '#2A2035', '#B23A3A', '#325099', '#777'
_n = [0]
def _esc(s): return html.escape(str(s), quote=True)
def fnum(v):
    s = ('%g' % v)
    return s.replace('-', '−')
class G:
    def __init__(s, xr, yr, w=324, h=240, pad=22, xt=1, yt=1, label_every=1, ticks=True):
        s.xmin, s.xmax = xr; s.ymin, s.ymax = yr; s.w, s.h, s.pad = w, h, pad; s.ticks = ticks
        s.xt, s.yt, s.le = xt, yt, label_every
        _n[0] += 1; s.id = f'g{_n[0]}'; s.body = []
    def X(s, x): return s.pad + (x - s.xmin) / (s.xmax - s.xmin) * (s.w - 2 * s.pad)
    def Y(s, y): return s.h - s.pad - (y - s.ymin) / (s.ymax - s.ymin) * (s.h - 2 * s.pad)
    def axes(s, xl='x', yl='y', origin=True):
        x0, y0 = s.X(0), s.Y(0)
        b = s.body
        b.append(f'<line x1="{s.pad-6:.1f}" y1="{y0:.1f}" x2="{s.w-s.pad+12:.1f}" y2="{y0:.1f}" stroke="{INK}" stroke-width="1.5" marker-end="url(#ah{s.id})"/>')
        b.append(f'<line x1="{x0:.1f}" y1="{s.h-s.pad+6:.1f}" x2="{x0:.1f}" y2="{s.pad-12:.1f}" stroke="{INK}" stroke-width="1.5" marker-end="url(#ah{s.id})"/>')
        b.append(f'<text x="{s.w-s.pad+12:.1f}" y="{y0-8:.1f}" font-size="13" fill="{INK}" text-anchor="end" font-style="italic" font-family="{FONT}">{xl}</text>')
        b.append(f'<text x="{x0+7:.1f}" y="{s.pad-4:.1f}" font-size="13" fill="{INK}" text-anchor="start" font-style="italic" font-family="{FONT}">{yl}</text>')
        k = 0
        v = math.ceil(s.xmin / s.xt) * s.xt
        while v <= s.xmax + 1e-9:
            if abs(v) > 1e-9 and s.xmin < v < s.xmax:
                xx = s.X(v); b.append(f'<line x1="{xx:.1f}" y1="{y0-3:.1f}" x2="{xx:.1f}" y2="{y0+3:.1f}" stroke="{INK}" stroke-width="1.1"/>')
                if s.ticks and round(v / s.xt) % s.le == 0: b.append(f'<text x="{xx:.1f}" y="{y0+15:.1f}" font-size="11" fill="#444" text-anchor="middle" font-family="{FONT}">{fnum(v)}</text>')
            v += s.xt
        v = math.ceil(s.ymin / s.yt) * s.yt
        while v <= s.ymax + 1e-9:
            if abs(v) > 1e-9 and s.ymin < v < s.ymax:
                yy = s.Y(v); b.append(f'<line x1="{x0-3:.1f}" y1="{yy:.1f}" x2="{x0+3:.1f}" y2="{yy:.1f}" stroke="{INK}" stroke-width="1.1"/>')
                if s.ticks and round(v / s.yt) % s.le == 0: b.append(f'<text x="{x0-6:.1f}" y="{yy+4:.1f}" font-size="11" fill="#444" text-anchor="end" font-family="{FONT}">{fnum(v)}</text>')
            v += s.yt
        if origin: b.append(f'<text x="{x0-5:.1f}" y="{y0+14:.1f}" font-size="11" fill="#444" text-anchor="end" font-style="italic" font-family="{FONT}">O</text>')
        return s
    def curve(s, f, xr=None, n=600, color=RED, width=2.4, dash=None, jump=None):
        a, c = xr or (s.xmin, s.xmax)
        pts, segs = [], []
        prev = None
        span = (s.ymax - s.ymin)
        for i in range(n + 1):
            x = a + (c - a) * i / n
            try: y = f(x)
            except Exception: y = None
            ok = y is not None and math.isfinite(y)
            if ok and prev is not None and abs(y - prev) > (jump or 3 * span):
                if pts: segs.append(pts); pts = []
            if ok:
                yy = max(s.ymin - span, min(s.ymax + span, y))
                pts.append((s.X(x), s.Y(yy)))
            else:
                if pts: segs.append(pts); pts = []
            prev = y if ok else None
        if pts: segs.append(pts)
        d = f' stroke-dasharray="{dash}"' if dash else ''
        for seg in segs:
            if len(seg) < 2: continue
            p = ' '.join(f'{x:.1f},{y:.1f}' for x, y in seg)
            s.body.append(f'<g clip-path="url(#clip{s.id})"><polyline points="{p}" fill="none" stroke="{color}" stroke-width="{width}"{d} stroke-linejoin="round"/></g>')
        return s
    def spline(s, pts, flat=(), color=RED, width=2.4, tension=0.5):
        """Smooth curve through pts (Catmull-Rom → cubic Bézier); indices in `flat` get a horizontal tangent."""
        P = [(s.X(x), s.Y(y)) for x, y in pts]
        d = f'M{P[0][0]:.1f},{P[0][1]:.1f}'
        for i in range(len(P) - 1):
            p0 = P[i - 1] if i > 0 else P[i]; p1 = P[i]; p2 = P[i + 1]; p3 = P[i + 2] if i + 2 < len(P) else P[i + 1]
            t1 = ((p2[0] - p0[0]) * tension / 1.5, 0 if i in flat else (p2[1] - p0[1]) * tension / 1.5)
            t2 = ((p3[0] - p1[0]) * tension / 1.5, 0 if (i + 1) in flat else (p3[1] - p1[1]) * tension / 1.5)
            c1 = (p1[0] + t1[0] / 3 * 1.5, p1[1] + t1[1] / 3 * 1.5); c2 = (p2[0] - t2[0] / 3 * 1.5, p2[1] - t2[1] / 3 * 1.5)
            d += f' C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}'
        s.body.append(f'<g clip-path="url(#clip{s.id})"><path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"/></g>')
        return s
    def vline(s, x, color=GREY, label=None):
        xx = s.X(x); s.body.append(f'<line x1="{xx:.1f}" y1="{s.pad-6:.1f}" x2="{xx:.1f}" y2="{s.h-s.pad+6:.1f}" stroke="{color}" stroke-width="1.2" stroke-dasharray="5,4"/>')
        if label: s.body.append(f'<text x="{xx+4:.1f}" y="{s.pad+4:.1f}" font-size="10" fill="{color}" text-anchor="start" font-family="{FONT}">{_esc(label)}</text>')
        return s
    def hline(s, y, color=GREY, label=None):
        yy = s.Y(y); s.body.append(f'<line x1="{s.pad-6:.1f}" y1="{yy:.1f}" x2="{s.w-s.pad+6:.1f}" y2="{yy:.1f}" stroke="{color}" stroke-width="1.2" stroke-dasharray="5,4"/>')
        if label: s.body.append(f'<text x="{s.w-s.pad+4:.1f}" y="{yy-4:.1f}" font-size="10" fill="{color}" text-anchor="end" font-family="{FONT}">{_esc(label)}</text>')
        return s
    def point(s, x, y, label=None, dx=6, dy=-5, color=RED, hollow=False, anchor='start'):
        xx, yy = s.X(x), s.Y(y)
        s.body.append(f'<circle cx="{xx:.1f}" cy="{yy:.1f}" r="3.2" fill="{"#fff" if hollow else color}" stroke="{color}" stroke-width="1.6"/>')
        if label: s.body.append(f'<text x="{xx+dx:.1f}" y="{yy+dy:.1f}" font-size="11" fill="{color}" text-anchor="{anchor}" stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round" font-family="{FONT}">{_esc(label)}</text>')
        return s
    def text(s, x, y, t, color=INK, size=11, anchor='start', italic=False):
        s.body.append(f'<text x="{s.X(x):.1f}" y="{s.Y(y):.1f}" font-size="{size}" fill="{color}" text-anchor="{anchor}"{" font-style=\"italic\"" if italic else ""} stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round" font-family="{FONT}">{_esc(t)}</text>')
        return s
    def inner(s, ox=0, oy=0):
        g = ''.join(s.body)
        return (f'<defs><clipPath id="clip{s.id}"><rect x="{s.pad:.1f}" y="{s.pad:.1f}" width="{s.w-2*s.pad:.1f}" height="{s.h-2*s.pad:.1f}"/></clipPath>'
                f'<marker id="ah{s.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{INK}"/></marker></defs>'
                f'<g transform="translate({ox},{oy})">{g}</g>')
    def svg(s):
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s.w} {s.h}" width="{s.w}" height="{s.h}"><rect width="100%" height="100%" fill="#ffffff"/>{s.inner()}</svg>'
    def uri(s): return 'data:image/svg+xml;base64,' + base64.b64encode(s.svg().encode()).decode()
def panels(graphs, labels, cols=2, gap=10):
    """Several graphs side by side in one SVG, each with a bold letter label."""
    w, h = graphs[0].w, graphs[0].h
    rows = math.ceil(len(graphs) / cols)
    W, H = cols * w + (cols - 1) * gap, rows * (h + 18) + (rows - 1) * gap
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}"><rect width="100%" height="100%" fill="#ffffff"/>']
    for i, (g, lab) in enumerate(zip(graphs, labels)):
        ox, oy = (i % cols) * (w + gap), (i // cols) * (h + 18 + gap)
        out.append(f'<text x="{ox+6}" y="{oy+13}" font-size="13" font-weight="700" fill="{INK}" font-family="{FONT}">{lab}</text>')
        out.append(f'<rect x="{ox+0.5}" y="{oy+18.5}" width="{w-1}" height="{h-1}" fill="none" stroke="#DEE7FF"/>')
        out.append(g.inner(ox, oy + 18))
    out.append('</svg>')
    return 'data:image/svg+xml;base64,' + base64.b64encode(''.join(out).encode()).decode()
