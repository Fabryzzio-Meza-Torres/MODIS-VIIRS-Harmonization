"""Exercise the actual language toggle, defaults and persistence in added sections."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json
from playwright.sync_api import sync_playwright

def verify(base,output):
    output.mkdir(parents=True,exist_ok=True)
    report={'base_url':base,'verified_at_utc':datetime.now(timezone.utc).isoformat(),'checks':[],'browser_errors':[]}
    with sync_playwright() as p:
        executable=Path(p.chromium.executable_path)
        browser=p.chromium.launch(**({'executable_path':str(executable)} if executable.exists() else {'channel':'chrome'}))
        for device,width,height in [('desktop',1440,1000),('mobile',390,844)]:
            context=browser.new_context(viewport={'width':width,'height':height})
            page=context.new_page()
            page.on('pageerror',lambda e:report['browser_errors'].append(str(e)))
            page.goto(base+'/#validacion',wait_until='domcontentloaded')
            page.get_by_test_id('evidence-example').first.wait_for(timeout=60000)
            assert page.locator('html').get_attribute('lang')=='en'
            page.get_by_role('combobox',name='Match',exact=True).select_option('both')
            example=page.get_by_test_id('evidence-example').first
            assert 'MODIS and VIIRS' in example.inner_text()
            example.locator('summary').press('Enter')
            assert 'Record attributed to INDECI' in example.inner_text()
            assert ' days' in example.inner_text()
            assert 'Code ' in example.inner_text() or 'Record ' in example.inner_text()
            page.get_by_text('Data provenance and integrity',exact=True).press('Enter')
            text=page.locator('body').inner_text()
            assert 'rows; downloaded' in text
            assert 'What this comparison validates and what remains open' in text
            assert 'Registro atribuido' not in text and 'filas; descarga' not in text
            page.locator('button[lang="es"]:visible').first.click()
            page.get_by_test_id('evidence-example').first.wait_for(timeout=60000)
            page.get_by_role('combobox',name='Coincidencia',exact=True).select_option('both')
            example=page.get_by_test_id('evidence-example').first
            assert 'MODIS y VIIRS' in example.inner_text()
            example.locator('summary').press('Enter')
            assert 'Registro atribuido a INDECI' in example.inner_text()
            assert ' días' in example.inner_text()
            page.reload(wait_until='domcontentloaded')
            page.get_by_test_id('evidence-example').first.wait_for(timeout=60000)
            assert page.locator('html').get_attribute('lang')=='es'
            page.goto(base+'/#pronostico?region=20',wait_until='domcontentloaded')
            page.get_by_test_id('activity-probability').wait_for(timeout=60000)
            assert 'Estimación para esta semana' in page.locator('body').inner_text()
            page.locator('button[lang="en"]:visible').first.click()
            page.get_by_test_id('activity-probability').wait_for(timeout=60000)
            assert page.locator('html').get_attribute('lang')=='en'
            page.get_by_text('Method, evaluation and limitations',exact=True).press('Enter')
            text=page.locator('body').inner_text()
            assert 'The reliability of each exact future percentage' in text
            assert 'No se ha demostrado' not in text and 'Escala: departamento' not in text
            assert 'Scope: the whole department' in text
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(output/f'{device}-english-forecast.png'))
            # Controlled failure checks translated recovery text without inventing observations.
            page.route('**/visor/validation-data/summary.json',lambda route:route.fulfill(status=503,body='unavailable'))
            page.goto(base+'/#validacion',wait_until='domcontentloaded')
            page.get_by_text('The evidence catalog could not be verified.',exact=False).wait_for(timeout=30000)
            page.locator('button[lang="es"]:visible').first.click()
            page.get_by_text('No se pudo verificar el catálogo de evidencia.',exact=False).wait_for(timeout=30000)
            report['checks'].append({'device':device,'fresh_default':'en','toggle_both_directions':True,'saved_preference':True,'expanded_evidence':True,'method_details':True,'translated_error':True})
            context.close()
        browser.close()
    assert not report['browser_errors'],report['browser_errors']
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--base',default='http://127.0.0.1:5174')
    parser.add_argument('--output',type=Path,default=Path('../../outputs/46_language_toggle'))
    args=parser.parse_args()
    print(json.dumps(verify(args.base,args.output),indent=2))
