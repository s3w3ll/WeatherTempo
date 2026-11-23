"""Fit harmonic constants to LINZ's official high/low table for New Brighton Pier.

  curl -o nb.pdf "https://static.charts.linz.govt.nz/tide-tables/maj-ports/pdf/New%20Brighton%20Pier%20<year>.pdf"
  pdftotext -layout nb.pdf nb.txt          # NOT -raw: its output was mismatched
  python tools/fit_linz_tides.py nb.txt app/src/core/__fixtures__/linz-new-brighton-<year>.json

Prints constants to paste into src/core/tidePorts.ts ("new-brighton"). The year
is hard-coded as 2026 below; change it (and the fixture name) when refitting.
Needs numpy. Do a Nov-24-style spot check against the PDF before committing.
"""
import re, sys, numpy as np, datetime as dt
from zoneinfo import ZoneInfo
txt=open(sys.argv[1],encoding='latin-1').read().split('\n')
MONTHS="January February March April May June July August September October November December".split()
tok=re.compile(r'(?:(\d{1,2})\s+|(?:Su|Mo|Tu|We|Th|Fr|Sa)\s+)?(\d\d:\d\d)\s+(-?\d\.\d+)')
ev=[];month=None;day=[None]*4
for ln in txt:
    m=re.search(r'(%s) 2026'%'|'.join(MONTHS),ln)
    if m: month=MONTHS.index(m.group(1))+1; day=[None]*4; continue
    if month is None: continue
    for t in tok.finditer(ln):
        x=t.start(2); c=0 if x<17 else 1 if x<38 else 2 if x<58 else 3
        if t.group(1): day[c]=int(t.group(1))
        if day[c] is None: continue
        hh,mm=map(int,t.group(2).split(':'))
        local=dt.datetime(2026,month,day[c],hh,mm,tzinfo=ZoneInfo('Pacific/Auckland'))
        ev.append((local.timestamp(),float(t.group(3))))
ev=sorted(set(ev)); print(len(ev),'events',file=sys.stderr)
if len(sys.argv)>2:
    import json
    json.dump([{'t':int(t*1000),'type':'high' if h>1.2 else 'low','m':h} for t,h in ev],open(sys.argv[2],'w'),separators=(',',':'))
# sanity: 24 Nov
for t,h in ev:
    d=dt.datetime.fromtimestamp(t,ZoneInfo('Pacific/Auckland'))
    if d.month==11 and d.day==24: print(d,h,file=sys.stderr)
T=np.array([(t*1000-946728000000)/3.6e6 for t,_ in ev]); H=np.array([h for _,h in ev])
C=[("M2",28.9841042,124.30),("S2",30.0,0.0),("N2",28.4397295,349.34),("K2",30.0821373,200.93),
   ("K1",15.0410686,280.47),("O1",13.9430356,203.83),("P1",14.9589314,79.53),("Q1",13.3986609,68.87),
   ("M4",57.9682084,248.60),("MS4",58.9841042,124.30),("MN4",57.4238337,113.64),("2N2",27.8953548,214.38),("MU2",27.9682084,0.0),("NU2",28.5125831,0.0),("L2",29.5284789,0.0),("T2",29.9589333,0.0),("J1",15.5854433,0.0),("OO1",16.1391017,0.0),("MSF",1.0158958,0.0),("M3",43.4761563,0.0)]
def design(T,deriv):
    cols=[]
    if not deriv: cols.append(np.ones_like(T))
    else: cols.append(np.zeros_like(T))
    for n,s,v in C:
        th=np.radians(s*T+v); w=np.radians(s)
        if not deriv: cols+= [np.cos(th),np.sin(th)]
        else: cols+= [-w*np.sin(th), w*np.cos(th)]
    return np.array(cols).T
A=np.vstack([design(T,False)/0.05, design(T,True)/0.01]); b=np.concatenate([H/0.05,np.zeros_like(H)])
x,*_=np.linalg.lstsq(A,b,rcond=None)
res=design(T,False)@x-H; print('height rms',res.std(),'max',abs(res).max(),file=sys.stderr)
print('Z0 %.3f'%x[0])
for i,(n,s,v) in enumerate(C):
    a,bb=x[1+2*i],x[2+2*i]; print('["%s", %.7f, %.3f, %.1f, %.2f],'%(n,s,np.hypot(a,bb),np.degrees(np.arctan2(bb,a))%360,v))
np.save(sys.argv[1]+'.x.npy',x)
