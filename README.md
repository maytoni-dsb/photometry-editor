# Photometry Editor

Онлайн-редактор фотометрических файлов IES и LDT (EULUMDAT): просмотр, редактирование,
конвертация, пакетная обработка, генерация вариантов и векторный экспорт графиков.
Вся обработка идёт в браузере — файлы не покидают компьютер пользователя.

Техническое задание ведётся в отдельном документе; решения и соглашения — в [docs/decisions.md](docs/decisions.md).

## Состояние

| Этап | Содержание | Статус |
| --- | --- | --- |
| 1 | ТЗ и эталонные файлы | готово |
| 2 | Ядро форматов: чтение / запись IES и LDT, тип B, проверка файлов | готово (v0.1) |
| 3 | Просмотр и векторные графики: паспорт, таблица, полярная и линейная КСС, экспорт SVG / PDF / EPS | готово (v0.2), ждёт сверки с Viso |
| 4 | Операции над телами | — |
| 5 | Пакетная обработка и генерация вариантов | — |
| 6 | Расчёты (UGR, BUG, изолюксы…) | — |
| 7 | Отчёты | — |

## Сайт

Сайт собирается и публикуется на GitHub Pages автоматически при каждом изменении ветки `main`
(`.github/workflows/pages.yml`). Один раз нужно включить: **Settings → Pages → Source: GitHub Actions**.
Адрес: `https://<владелец>.github.io/<репозиторий>/`.

## Структура

```
src/app/           веб-интерфейс (React): загрузка, паспорт, таблица, графики, стиль
  locales/         тексты интерфейса ru / en / de
src/charts/        графики без интерфейса: сцена → SVG / PDF / EPS
  scene.ts         описание рисунка (мм, примитивы, цвет RGB + CMYK)
  polar.ts         полярная КСС
  linear.ts        линейная КСС
  series.ts        выбор плоскостей, единицы, шкала
  style.ts         стиль графиков (шрифт, цвета, толщины, сетка)
  render-svg.ts    SVG (экран и экспорт)
  render-pdf.ts    PDF (pdf-lib, шрифт встраивается)
  render-eps.ts    EPS (шрифт Type 42 или кривые)
src/core/          ядро без интерфейса (работает и в браузере, и в Node)
  model.ts         единая модель фотометрии (силы света в абсолютных кд)
  ies.ts           чтение / запись IES (LM-63-1986…2019, тип C и B)
  ldt.ts           чтение / запись EULUMDAT (Isym 0–4)
  typeb.ts         пересчёт типа B в тип C
  angles.ts        симметрия, свёртка углов, интерполяция
  flux.ts          расчёт светового потока
  validate.ts      проверка файлов, сверка пар IES/LDT
  summary.ts       сводка: поток, Iмакс, поток для кд/клм
  issues.ts        коды замечаний и тексты на ru / en / de
public/fonts/      встроенный шрифт графиков Roboto (Apache 2.0)
scripts/
  audit-library.ts проверка целой папки с файлами, отчёт CSV/JSON
  render-charts.ts графики папки файлов в SVG / PDF / EPS (для сверки)
tests/             автотесты (vitest)
```

## Как обновить репозиторий из bundle

Каждая новая версия приходит файлом `photometry-editor.bundle`.

Первый раз:

```bash
git clone photometry-editor.bundle photometry-editor
cd photometry-editor
git remote add origin https://github.com/<ваш-логин>/<репозиторий>.git
git push -u origin main
```

Дальше, после каждого нового bundle (положите его рядом с папкой репозитория):

```bash
cd photometry-editor
git pull ../photometry-editor.bundle main
git push
```

## Для разработки

Нужен Node.js 20 или новее.

```bash
npm install
npm run dev                 # сайт локально: http://localhost:5173
npm run build               # сборка сайта в dist/
npm test                    # автотесты
npm run typecheck           # проверка типов
npm run audit -- <папка>    # проверить библиотеку файлов, отчёт в reports/
npm run charts -- <папка>   # построить графики всех файлов папки в reports/charts
PHOTOMETRY_LIBRARY=<папка> npm test   # прогнать тесты на реальной библиотеке
```

Реальные файлы заказчика в репозиторий не кладутся (папки `private-data/` и `reports/` в `.gitignore`).
