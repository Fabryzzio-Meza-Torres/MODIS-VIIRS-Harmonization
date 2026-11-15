"""Publicación offline y transaccional de un lote armonizado previamente validado."""
import argparse
import csv
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
import re
import sqlite3
from contextlib import closing

from prepare_data import file_hash


def week_date(value):
    if len(value)==10:
        day=date.fromisoformat(value)
    else:
        stamp=datetime.fromisoformat(value.replace('Z','+00:00'))
        if stamp.tzinfo is None:
            raise ValueError('Semana con timestamp sin zona horaria.')
        stamp=stamp.astimezone(timezone.utc)
        if stamp.time().isoformat()!='00:00:00':
            raise ValueError('La semana debe empezar a medianoche UTC.')
        day=stamp.date()
    if day.weekday()!=0:
        raise ValueError('La semana debe comenzar un lunes UTC.')
    return day.isoformat()


def number(value):
    if value in (None,''):
        return None
    n=float(value)
    if not math.isfinite(n) or n<0:
        raise ValueError('Valor armonizado o límite inválido.')
    return n


def publish(database, csv_file, manifest_file, validation_report):
    csv_file, validation_report=Path(csv_file),Path(validation_report)
    meta=json.loads(Path(manifest_file).read_text(encoding='utf-8'))
    required=['method_version','reference_scale','source_snapshot_id','interval_level']
    if not all(meta.get(k) for k in required):
        raise ValueError('Falta el contrato de método, escala, fuentes o intervalo.')
    if not 0<float(meta['interval_level'])<1:
        raise ValueError('Nivel del intervalo inválido.')
    if meta.get('validation_status')!='accepted' or meta.get('human_reviewed') is not True:
        raise ValueError('El lote necesita validación y revisión humana aceptadas.')
    if meta.get('data_sha256')!=file_hash(csv_file):
        raise ValueError('Hash del lote no coincide con el manifiesto validado.')
    if meta.get('validation_report_sha256')!=file_hash(validation_report):
        raise ValueError('Hash del informe de validación no coincide.')
    count=0
    with closing(sqlite3.connect(Path(database).resolve().as_uri()+'?mode=rw',uri=True)) as db:
        try:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM harmonized')
            with csv_file.open(encoding='utf-8',newline='') as stream:
                for r in csv.DictReader(stream):
                    if not re.fullmatch(r'laea10_-?\d{1,5}_-?\d{1,5}',r['cell_id']):
                        raise ValueError('Identificador de celda inválido.')
                    status=r['estimation_status']
                    if status not in ['estimated','imputed','unavailable']:
                        raise ValueError('Estado de estimación inválido.')
                    if r['coverage_status'] not in ['valid','partial','unknown','no_observation']:
                        raise ValueError('Estado de cobertura inválido.')
                    value,low,high=[number(r[k]) for k in ['harmonized_count','lower_bound','upper_bound']]
                    if status=='unavailable':
                        if any(v is not None for v in [value,low,high]):
                            raise ValueError('No disponible exige valores null.')
                    elif value is None or low is None or high is None or not low<=value<=high:
                        raise ValueError('Estimación o imputación exige intervalo válido.')
                    platforms=json.loads(r['platforms_used'])
                    allowed={'Terra','Aqua','Suomi-NPP','NOAA-20','NOAA-21'}
                    if not isinstance(platforms,list) or any(not isinstance(p,str) or p not in allowed for p in platforms):
                        raise ValueError('Lista de plataformas inválida.')
                    if r['method_version']!=meta['method_version'] or r['source_snapshot_id']!=meta['source_snapshot_id']:
                        raise ValueError('Versión o procedencia no coincide con el manifiesto.')
                    db.execute('INSERT INTO harmonized VALUES (?,?,?,?,?,?,?,?,?,?)',(
                        r['cell_id'],week_date(r['week_start_utc']),value,low,high,r['coverage_status'],
                        status,json.dumps(platforms),r['method_version'],r['source_snapshot_id']))
                    db.execute('INSERT OR IGNORE INTO cells VALUES (?)',(r['cell_id'],))
                    count+=1
            if count==0:
                raise ValueError('No se publica un lote vacío.')
            public_keys=required+['data_sha256','validation_report_sha256','validation_status','human_reviewed']
            info={**{k:meta[k] for k in public_keys},'name':'harmonized','status':'validated_published',
                  'unit':'equivalent hotspot detection count per cell and UTC week',
                  'timezone':'UTC','end_is_exclusive':True,'row_count':count}
            db.execute('INSERT OR REPLACE INTO datasets VALUES (?,?)',('harmonized',json.dumps(info)))
            db.commit()
        except Exception:
            db.rollback()
            raise
    return count


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for arg in ['database','csv','manifest','validation-report']:
        p.add_argument('--'+arg,required=True,type=Path)
    a=p.parse_args()
    print('Filas publicadas:',publish(a.database,a.csv,a.manifest,a.validation_report))
