#!/usr/bin/env python3
# SmartSetu S23-F-2a guard (AI sandbox tool). ASCII only.
# Usage: python3 pixel_compare.py <old www/index.html> <new www/index.html> [chrome path]
# Renders both versions at text-zoom 1.0 (animations frozen, same moment) at 6 widths and counts differing pixels in the
# home screen. A phone that looks right today must not change: PASS only if every width that passed in fit_matrix.py before is identical.
import sys, os, io
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops
W=[320,360,375,393,412,430]
old=os.path.abspath(sys.argv[1]); new=os.path.abspath(sys.argv[2]); chrome=sys.argv[3] if len(sys.argv)>3 else None
FREEZE='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
def shot(b,page,w):
  c=b.new_context(viewport={'width':w,'height':780},device_scale_factor=2,is_mobile=True,has_touch=True)
  pg=c.new_page(); pg.goto('file://'+page); pg.add_style_tag(content=FREEZE); pg.wait_for_timeout(900)
  im=Image.open(io.BytesIO(pg.screenshot())).convert('RGB'); c.close(); return im
with sync_playwright() as p:
  b=p.chromium.launch(executable_path=chrome,args=['--no-sandbox']) if chrome else p.chromium.launch(args=['--no-sandbox'])
  for w in W:
    a=shot(b,old,w); n=shot(b,new,w); a2=shot(b,old,w)
    noise=sum(1 for px in ImageChops.difference(a,a2).getdata() if px!=(0,0,0))
    diff=sum(1 for px in ImageChops.difference(a,n).getdata() if px!=(0,0,0))
    print('%d old-vs-old %d px, old-vs-new %d px %s'%(w,noise,diff,'IDENTICAL' if diff==0 else 'DIFFERENT'))
  b.close()
