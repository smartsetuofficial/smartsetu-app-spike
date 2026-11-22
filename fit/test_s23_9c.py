#!/usr/bin/env python3
# S23-9c Croma pincode loop test in real Chromium (AI sandbox tool, owner does not run it). Usage: python3 test_s23_9c.py <path to src/webtabs.js>
import sys, subprocess, json
from playwright.sync_api import sync_playwright
src = subprocess.check_output(['node', '-e', "console.log(require(process.argv[1]).pincodeSet.toString())", sys.argv[1]]).decode()
def page(body): return '<html><body><div id=top><button id=op>Add Pincode</button></div>' + body + '</body></html>'
FIELD = '<div id=m><div class=row><input placeholder="Enter Pincode" id=pin>%s</div><button id=x aria-label=close>X</button></div>'
CLOSE = "document.getElementById('m').remove()"
cases = {
 'apply_after_decoy': FIELD % ('<button id=c>Continue</button><div role=button id=a onclick="%s">Check</div>' % CLOSE),
 'only_continue': FIELD % ('<div role=button id=c onclick="%s">Continue</div>' % CLOSE),
 'nothing_works': FIELD % '<button id=c>Continue</button><button id=a>Apply</button><button id=z>Submit</button><button id=y>Check</button><button id=w>Confirm</button><button id=u>Update</button>',
 'opener': '<div id=host></div><script>document.getElementById("op").onclick=function(){var m=document.createElement("div");m.id="m";var i=document.createElement("input");i.placeholder="Enter Pincode";var b=document.createElement("button");b.textContent="Apply";b.onclick=function(){m.remove()};m.appendChild(i);m.appendChild(b);document.getElementById("host").appendChild(m)}</script>',
}
fails = 0
def ck(n, c, x=None):
    global fails
    if not c: fails += 1; print('FAIL', n, x)
    else: print('ok  ', n)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox']); pg = b.new_page()
    def run(name):
        pg.set_content(page(cases[name])); return pg.evaluate('async (a)=>{const f=(' + src + ');return await f(a)}', '400001')
    r = run('apply_after_decoy'); ck('1 best word (Check) tried before Continue, field gone', r['found'] and not r['fieldStill'] and any('Check' in s and 'gone' in s for s in r['steps']) and not any('Continue' in s for s in r['steps']), r)
    r = run('only_continue'); ck('2 Continue still used when it is the only control', not r['fieldStill'] and any('Continue' in s and 'gone' in s for s in r['steps']), r)
    r = run('nothing_works'); clicks = [s for s in r['steps'] if s.startswith('clicked')]
    ck('3 nothing works: at most 4 tries, field still there, HTML reported, close and opener never clicked', r['fieldStill'] and len(clicks) <= 4 and len(clicks) >= 1 and 'Enter Pincode' in r['htmlNear'] and not any('(no text)' in s or 'Add Pincode' in s for s in clicks) and 'Enter sent' in r['steps'], r)
    r = run('opener'); ck('4 opener opens the field, Apply sets it', r['found'] and not r['fieldStill'] and r['steps'][0].startswith('opened'), r)
    b.close()
print('FAILED: %d' % fails); sys.exit(1 if fails else 0)
