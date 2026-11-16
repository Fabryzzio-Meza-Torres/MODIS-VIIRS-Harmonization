"""Check translated capital categories in the real province table and map tooltips."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json
from playwright.sync_api import sync_playwright

def verify(base):
    with sync_playwright() as p:
        executable=Path(p.chromium.executable_path)
        browser=p.chromium.launch(**({'executable_path':str(executable)} if executable.exists() else {'channel':'chrome'}))
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.goto(base+'/#mapa?region=02',wait_until='domcontentloaded')
        # The production map uses a canvas renderer. Selecting a real province
        # exposes the capital's permanent tooltip without relying on SVG nodes.
        province=page.get_by_role('button',name='Pallasca',exact=True)
        province.wait_for(timeout=60000);province.press('Enter')
        page.wait_for_function("[...document.querySelectorAll('.leaflet-tooltip')].some(e=>e.textContent.includes('capital of'))")
        tooltip=page.locator('.leaflet-tooltip').all_inner_texts()
        assert any('capital of' in x and any(k in x for k in ['City','Town','Village']) for x in tooltip)
        page.get_by_role('button',name='← All provinces',exact=True).press('Enter')
        page.get_by_role('radio',name='Historical events',exact=True).press('Enter')
        page.get_by_role('cell',name='City',exact=True).first.wait_for(timeout=60000)
        table=page.locator('table').filter(has=page.get_by_role('columnheader',name='Type',exact=True))
        assert table.count()==1
        categories=table.locator('tbody tr td:last-child').all_inner_texts()
        assert set(categories) <= {'City','Town','Village','—'}
        page.locator('button[lang="es"]:visible').first.press('Enter')
        province=page.get_by_role('button',name='Pallasca',exact=True)
        province.wait_for(timeout=60000);province.press('Enter')
        page.wait_for_function("[...document.querySelectorAll('.leaflet-tooltip')].some(e=>e.textContent.includes('capital de'))")
        tooltip_es=page.locator('.leaflet-tooltip').all_inner_texts()
        assert any('capital de' in x and any(k in x for k in ['Ciudad','Villa','Pueblo']) for x in tooltip_es)
        page.get_by_role('button',name='← Todas las provincias',exact=True).press('Enter')
        page.get_by_role('radio',name='Eventos históricos',exact=True).press('Enter')
        page.get_by_role('cell',name='Ciudad',exact=True).first.wait_for(timeout=60000)
        report={'base_url':base,'verified_at_utc':datetime.now(timezone.utc).isoformat(),
            'english_categories_translated':True,'spanish_toggle_restores_categories':True,
            'english_tooltips':tooltip,'spanish_tooltips':tooltip_es,'proper_place_names_preserved':True}
        browser.close()
        return report

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--base',default='https://fuegotrazo-modis-viirs.netlify.app')
    parser.add_argument('--output',type=Path,default=Path('reports/prediction/activity_v02/geographic_labels_verification.json'))
    args=parser.parse_args();report=verify(args.base)
    args.output.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2,ensure_ascii=False))
