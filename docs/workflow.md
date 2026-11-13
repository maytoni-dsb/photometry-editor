# Порядок работы над кодом

- Репозиторий (публичный, только чтение для Claude): https://github.com/maytoni-dsb/photometry-editor
- Claude не пушит в GitHub. Каждая версия передаётся файлом `photometry-editor.bundle` (всегда это имя, внутри — вся история, ветка main).
- Пользователь обновляет так (Windows, Git Bash, папка C:\Projects\photometry-editor):
  `git pull bundle main` → `git push`  (remote `bundle` указывает на C:\Projects\photometry-editor.bundle).
- В новом чате: Claude клонирует репозиторий по ссылке выше и продолжает от него, чтобы новые bundle ложились без конфликтов.
- Реальные файлы библиотеки MAYTONI в репозиторий не кладутся (репозиторий публичный); тесты на них Claude прогоняет у себя (`PHOTOMETRY_LIBRARY=<папка> npm test`). Обзор библиотеки (`claude/test-library-survey.md`: артикулы, дефекты) — только в проекте Claude, в репозиторий его не копировать.
- Документы проекта лежат в `docs/` и обновляются вместе с кодом:
  - `docs/tz.md` — копия ТЗ (главный экземпляр — документ Claude «Онлайн-редактор фотометрических файлов — ТЗ (черновик)», https://claude.ai/artifact/MbszB6EoWtwc7gnvo54G2X); решения по ходу работы вносятся в оба;
  - `docs/decisions.md` — решения и соглашения;
  - `docs/status.md` — состояние проекта;
  - `docs/workflow.md` — этот файл.
