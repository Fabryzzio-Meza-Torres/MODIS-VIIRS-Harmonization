"""Bounded desktop/mobile browser checks against real local evidence files."""
from pathlib import Path
import argparse,json
from playwright.sync_api import sync_playwright

def verify(base,output):
    output.mkdir(parents=True,exist_ok=True)
    report={'base_url':base,'checks':[],'screenshots':[],'browser_errors':[]}
    with sync_playwright() as p:
        executable=Path(p.chromium.executable_path)
        browser=p.chromium.launch(**({'executable_path':str(executable)} if executable.exists() else {'channel':'chrome'}))
        for name,width,height in [('desktop',1440,1000),('mobile',390,844)]:
            page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
            page.on('pageerror',lambda error:report['browser_errors'].append(str(error)))
            page.goto(base+'/visor/#validacion',wait_until='networkidle')
            page.wait_for_function("document.querySelectorAll('.validation-case').length === 12")
            assert page.locator('#validation-error').is_hidden()
            assert page.locator('#validation-primary tr').count()==2
            assert page.locator('#validation-primary').inner_text().find('45.1 %')>=0
            assert page.locator('#validation-model tr').count()==3
            page.locator('#validation-status').select_option('modis')
            assert all('Solo MODIS' in text for text in page.locator('.validation-case summary').all_text_contents())
            assert page.locator('#validation-status option[value=none]').count()==0
            page.locator('.validation-case').first.locator('summary').click()
            page.wait_for_selector('.validation-case-body')
            assert page.locator('.validation-case').first.locator('.validation-evidence article').count()==1
            page.locator('#validation-status').select_option('both')
            page.locator('.validation-case').first.locator('summary').click()
            page.wait_for_selector('.validation-evidence article')
            assert page.locator('.validation-case').first.locator('.validation-evidence article').count()==2
            assert 'distancia' in page.locator('.validation-case-body').first.inner_text().lower()
            assert page.locator('.validation-case').first.locator('a[href*="geoservidorperu"]').count()>=2
            before=page.locator('.validation-case summary').first.inner_text()
            page.locator('#validation-next').click()
            assert page.locator('.validation-case summary').first.inner_text()!=before
            page.locator('#validation-previous').click()
            page.locator('.validation-case').first.locator('summary').click()
            page.wait_for_selector('.validation-evidence article')
            page.evaluate("document.getElementById('validacion').scrollIntoView({block:'start'})")
            file=output/f'{name}-validation.png'
            page.screenshot(path=str(file))
            report['screenshots'].append(str(file.resolve()))
            page.locator('.validation-case').first.evaluate("e => e.scrollIntoView({block:'start'})")
            file=output/f'{name}-case.png';page.screenshot(path=str(file))
            report['screenshots'].append(str(file.resolve()))
            # All snapshots are loaded from actual files. This simulated HTTP error
            # only exercises recovery, never creates sample observations.
            pending=[]
            page.route('**/validation-data/cases-2014.json.gz',lambda route:pending.append(route))
            page.locator('#validation-year').select_option('2014')
            assert page.locator('#validation-download').is_hidden()
            assert page.locator('#validation-download').get_attribute('href') is None
            page.wait_for_timeout(100)
            assert pending
            pending[0].fulfill(status=503,body='unavailable')
            page.wait_for_function("!document.getElementById('validation-error').hidden")
            assert page.locator('.validation-case').count()==0
            page.unroute('**/validation-data/cases-2014.json.gz')
            page.locator('#validation-status').select_option('')
            page.locator('#validation-year').select_option('2013')
            page.wait_for_function("document.getElementById('validation-download').href.endsWith('cases-2013.json') && document.querySelectorAll('.validation-case').length > 0")
            assert page.locator('#validation-error').is_hidden()
            page.locator('#validation-year').select_option('2024')
            page.locator('#validation-year').select_option('2013')
            page.wait_for_function("document.getElementById('validation-download').href.endsWith('cases-2013.json') && document.querySelectorAll('.validation-case').length > 0")
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),name
            report['checks'].append({'viewport':name,'actual_data':True,'matched_examples_only':True,
                'both_instruments_detail':True,'pagination':True,'source_links':True,
                'failure_and_recovery':True,'rapid_filter_changes':True,'no_horizontal_overflow':True})
            page.close()
        browser.close()
    assert not report['browser_errors'],report['browser_errors']
    (output/'browser_checks.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:8011')
    p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    verify(args.base,args.output)
