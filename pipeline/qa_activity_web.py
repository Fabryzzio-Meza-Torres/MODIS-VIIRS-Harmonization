"""Check the actual activity API and matching evidence in desktop/mobile layouts."""
from pathlib import Path
import argparse,json
from playwright.sync_api import sync_playwright

def verify(base,output):
    output.mkdir(parents=True,exist_ok=True)
    report={'base_url':base,'checks':[],'screenshots':[],'errors':[]}
    with sync_playwright() as p:
        executable=Path(p.chromium.executable_path)
        browser=p.chromium.launch(**({'executable_path':str(executable)} if executable.exists() else {'channel':'chrome'}))
        for name,width,height in [('desktop',1440,1000),('mobile',390,844)]:
            page=browser.new_page(viewport={'width':width,'height':height})
            page.on('pageerror',lambda e:report['errors'].append(str(e)))
            requests=[]
            page.on('request',lambda r:requests.append(r.url))
            page.goto(base+'/#pronostico?region=20&prov=2007',wait_until='domcontentloaded')
            page.get_by_test_id('activity-probability').wait_for(timeout=60000)
            text=page.locator('body').inner_text()
            assert '32 de 32' in text
            assert 'provincia' in text.lower()
            assert not any('/v1/fire-risk' in u for u in requests)
            assert not any('prov=' in u for u in requests if '/v1/fire-activity' in u)
            page.get_by_test_id('activity-probability').scroll_into_view_if_needed()
            path=output/f'{name}-forecast.png'
            page.screenshot(path=str(path));report['screenshots'].append(str(path.resolve()))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),name+' forecast overflow'
            page.goto(base+'/#validacion',wait_until='domcontentloaded')
            page.get_by_test_id('evidence-example').first.wait_for(timeout=60000)
            text=page.locator('body').inner_text()
            assert 'sin coincidencia' not in text.lower()
            assert 'Ejemplos con coincidencia documentada' in text
            assert page.get_by_test_id('evidence-example').count()<=10
            path=output/f'{name}-evidence.png'
            page.screenshot(path=str(path));report['screenshots'].append(str(path.resolve()))
            example=page.get_by_test_id('evidence-example').first
            example.locator('summary').click();example.scroll_into_view_if_needed()
            assert example.locator('a[href*="geoservidorperu"]').count()>0
            path=output/f'{name}-case.png'
            page.screenshot(path=str(path));report['screenshots'].append(str(path.resolve()))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),name+' evidence overflow'
            report['checks'].append(name+': actual forecast, historical denominator, scope, official evidence and layout verified')
            page.close()
        browser.close()
    assert not report['errors'],report['errors']
    (output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--base',default='http://127.0.0.1:5174')
    parser.add_argument('--output',type=Path,default=Path('../../outputs/45_activity_web/qa'))
    args=parser.parse_args()
    print(json.dumps(verify(args.base,args.output),indent=2))
