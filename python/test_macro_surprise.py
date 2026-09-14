import json
import statistics
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
import macro_sources as sources
from macro_api import app
from macro_surprise import calculate, numeric, import_csv, read_pairs


def sample():
    return [dict(id=str(i),title='Core CPI m/m',date=f'2024-{i//28+1:02d}-{i%28+1:02d}T13:30:00+00:00',precision='time',source='fixture',impact='High',currency='USD',actual=f'{.2+(-.1 if i%2 else .1):.1f}%',forecast='0.2%',unit=None) for i in range(16)]


class SurpriseTests(unittest.TestCase):
    def test_actual_zero_and_numeric_units(self):
        self.assertEqual(numeric('0%'),(0.,'percent'));self.assertEqual(numeric('150K'),(150000.,'count'))
        self.assertEqual(numeric('0.15M'),numeric('150K'));self.assertEqual(numeric('150','thousands'),numeric('150K'))
        for value in ['NaN','1-2','2.0abc',True,'',None,'1,2'] :self.assertIsNone(numeric(value))
        self.assertEqual(sources.parse_ff(json.dumps([dict(title='CPI',country='USD',impact='High',date='2024-01-01T13:30:00Z',actual=0,forecast=0,previous=0)]))[0]['actual'],'0')

    def test_known_score_uses_only_prior_surprises(self):
        rows=sample();rows[12]['actual']='0.4%'
        result=calculate(rows,36,.5,as_of='2025-01-01T00:00:00Z');r=next(r for r in result['rows'] if r['id']=='12')
        self.assertEqual(r['history_n'],12);self.assertAlmostEqual(r['score'],.2/statistics.stdev([.1,-.1]*6))
        self.assertEqual(r['classification'],'Above expectations');self.assertEqual(r['magnitude'],'Large')
        rows[-1]['actual']='100000%';r2=next(r for r in calculate(rows)['rows'] if r['id']=='12');self.assertEqual(r['score'],r2['score'])

    def test_no_pooling_definition_source_unit_or_simultaneous(self):
        rows=sample();rows[0]['title']='Core CPI y/y';rows[1]['source']='another';rows[2]['unit']='m/m %'
        r=next(r for r in calculate(rows)['rows'] if r['id']=='12');self.assertEqual(r['history_n'],9);self.assertIsNone(r['score'])
        rows=sample();rows[11]['date']=rows[12]['date'];r=next(r for r in calculate(rows)['rows'] if r['id']=='12');self.assertEqual(r['history_n'],11)

    def test_missing_or_zero_variance_is_not_neutral(self):
        rows=sample()
        for row in rows:row['actual']='.2%'
        r=calculate(rows)['rows'][0];self.assertIsNone(r['score']);self.assertEqual(r['classification'],'Unscored');self.assertIn('variance is zero',r['status'])
        rows[-1]['actual']=None;r=calculate(rows)['rows'][0];self.assertEqual(r['status'],'Missing actual / consensus')
        rows[-1]['actual']='1K';r=calculate(rows)['rows'][0];self.assertEqual(r['status'],'Unit mismatch')

    def test_neutral_centered_z_and_future_exclusion(self):
        rows=sample();rows[-1]['actual']='.2%';r=calculate(rows)['rows'][0]
        self.assertEqual(r['score'],0);self.assertEqual(r['classification'],'Neutral');self.assertNotEqual(r['centered_z'],0)
        rows[-1]['date']='2999-01-01T00:00:00Z';self.assertEqual(len(calculate(rows)['rows']),15)

    def test_import_validation_atomic_preview_and_idempotency(self):
        text='series,date,actual,forecast,unit,source_url\nCore CPI m/m,2024-01-01T13:30:00Z,.3,.2,percent,https://example.com/releases\n'
        with tempfile.TemporaryDirectory() as tmp,patch.object(sources,'DB',Path(tmp)/'macro.db'):
            self.assertFalse(import_csv(text)['saved']);self.assertEqual(read_pairs(),[])
            import_csv(text,True);import_csv(text,True);self.assertEqual(len(read_pairs()),1)
            with sources.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM surprise_imports').fetchone()[0],1)
            for bad in [text.replace('2024','2999'),text.replace('.3','3K'),text.replace('https://','javascript:'),text+text.splitlines()[1]+'\n',text.replace('T13:30:00Z','')]:
                with self.assertRaises(ValueError):import_csv(bad,True)
            self.assertEqual(len(read_pairs()),1)
            import_csv(text.replace('.3','.4'),True);self.assertEqual(read_pairs()[0]['actual'],'.4')
            with sources.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM surprise_imports').fetchone()[0],2)

    def test_api_validation_and_scoring_serialization(self):
        client=TestClient(app)
        for q in ['window=1','neutral=nan','neutral=9']:self.assertEqual(client.get('/api/macro/surprises?'+q).status_code,422)
        with patch('macro_api.read_pairs',return_value=sample()):
            response=client.get('/api/macro/surprises');self.assertEqual(response.status_code,200);self.assertEqual(response.json()['scored'],4)
        self.assertEqual(client.post('/api/macro/surprises/import',json=dict(csv_text='bad',save=True)).status_code,422)

if __name__=='__main__':unittest.main()
