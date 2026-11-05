# Superfluid: повторная проверка UI после внедрения T3 recipes

Дата: 5 ноября 2026. Независимая проверка реальных Electron-снимков и текущих UI исходников. Это проверка первого визуального прохода; найденные ниже три доработки ещё не считаются проверенными.

## Результат

Superfluid стал существенно ближе к чистоте T3 Code. Основные проблемы исходного UI — слишком мелкие действия, серо-синие поверхности, случайные веса и многократные повторы ветки — исправлены. Дальнейшая декоративная переработка не нужна. Остались три конкретных UX/accessibility дефекта, из-за которых минимум пока **7/10**.

Сравнение основано на T3 revision `337c5858c33bc7f8f6dfd391a2c279fa0f7e4d17`, исходных recipes из [UI_REVIEW.md](UI_REVIEW.md), повторно прочитанных `threadDetailsPanelStyles.ts` и light tokens `index.css`, и одиннадцати новых снимках Superfluid. T3 runtime и пользовательские Appearance preferences не запускались.

Снимки этого прохода сохранены отдельно в `test-results/ui-recheck-1/`, чтобы последующий e2e не перезаписал основания оценки.

## Оценки по тем же восьми критериям

| Критерий | Исходный UI | После первого прохода | Основание |
|---|---:|---:|---|
| Читаемая типографика | 4 | **9** | Основные controls14px, island13/20, secondary12px; хорошие размеры PR body/title и dialog. Общий sans/mono stack, обычные400/500/600 weights. Текст стал читаемым без искусственного увеличения всех панелей. |
| Соответствие визуальному языку T3 | 5 | **8** | Neutral zinc shell и белые поверхности; row recipe13px/32px/16pxicons; tabs12px/24px; segmented PR, спокойные borders. Шрифтовой стек перенесён буквально; Tailwind recipes честно адаптированы в CSS. |
| Иерархия и отсутствие шума | 5 | **9** | WT strip сохраняет ключевую функцию IDE, ветка не повторяется в шести местах; больше нет отдельного sidebar footer и дублирующей шапки острова. Основной редактор и правая поверхность читаются ясно. |
| Геометрия и консистентность | 5 | **8** | Левый/правый tabs и controls приведены к общей шкале. Остров, формы, menu и palette выглядят одной системой; divider1px имеет расширенную hit area. Toolbar clipping учтён отдельно ниже. |
| Рабочая поверхность IDE | 6 | **7** | Остров ограничен viewport, collapse/Stop видны на1280×800, code/terminal/diff согласованы. Однако правая tab strip прокручивает вместе с вкладками важные Expand/Hide controls за край окна. |
| Управление и обратная связь | 6 | **7** | Base UI Git menu и tab keyboard behavior значительно лучше. Но launcher показывает неподдержанные B/T/F/D/P keycaps; clipping панели дополнительно мешает быстрому закрытию. |
| Доступность и контраст | 5 | **7** | Контраст обычного текста на white/zinc50 исправлен, focus видим, controls достаточно крупны. Остались muted labels на accent/shortcut/segmented backgrounds ниже4.5:1. |
| Сохранение отзывчивости | 8 | **8** | Нет blur/spring, новых per-row observers и React text state. Родитель предоставил smoke30warm switches с p95≈5ms/errors[]; это хороший guard данного UI прохода, но не полноценный нагрузочный gate. |

Оценки9 означают сильный результат в данном scope, а не завершённую IDE или полное соответствие всем release-gates.

## Три необходимых исправления

### 1. Вынести toolbar controls из горизонтально прокручиваемых вкладок

**Evidence:** [1280×800](test-results/ui-recheck-1/workspace-1280.png). В правом header открыты Terminal, Python smoke, Diff и Pull request. Hide secondary surface находится за правой границей; Expand частично виден. Пользователь видит обрезанную полосу, хотя сама панель помещается.

**Причина:** `apps/web/src/Surfaces.tsx:480` помещает tabs, Plus, spacer, Expand и Hide в один `.surface-tabs`; `style.css` задаёт этому общему контейнеру `overflow-x:auto`. Кнопки не закреплены справа. Аналогичная структура в `Workspace.tsx:231` позволяет утопить Open current file to the side при большом количестве файлов.

**Минимальная правка:** outer `.surface-header`/`.editor-header` остаётся flex40px. Внутри отдельный scrollable tablist: `min-width:0; flex:1; overflow-x:auto`. Toolbar справа — отдельная `display:flex; flex:none` группа. Не добавлять dropdown или переписывать lifecycle/DnD.

**Проверка:** при1280×800 и четырёх правых вкладках Plus/Expand/Hide полностью видны без прокрутки tablist; Hide закрывает панель. То же для Open file to side при длинном наборе main tabs. Keyboard arrows остаются в tablist и не обходят toolbar controls как вкладки.

### 2. Убрать ложные keyboard hints launcher

**Evidence:** `apps/web/src/Surfaces.tsx:561–607` показывает keycaps B/T/F/D/P, но компонент обрабатывает только `onClick`; общего single-key launcher handler нет. Сами системные shortcuts CmdP/CtrlTab работают и к дефекту не относятся.

**Минимальная правка:** удалить неподдержанные keycaps из launcher. Альтернатива — реализовать single-key обработку только внутри явно открытого и сфокусированного launcher, но это больше кода и не требуется для завершения визуального прохода. Не перехватывать буквы в Monaco глобально.

**Проверка:** launcher показывает только реально работающие способы взаимодействия. Для оставшихся системных hints поведение и надпись совпадают.

### 3. Использовать более контрастный secondary text на серых fills

**Evidence:** `theme.css` даёт `--muted-foreground:#71717a`, `--accent:#f4f4f5`. Расчёт относительной sRGB luminance даёт:

| Текст | Фон | Contrast |
|---|---|---:|
| zinc500 `#71717a` | white `#fff` |4.83:1 |
| zinc500 `#71717a` | zinc50 `#fafafa` |4.63:1 |
| zinc500 `#71717a` | accent `#f4f4f5` |**4.40:1** |

Поэтому менять muted token глобально не нужно. Проблема только в контекстах: `.palette-result.selected` и её `small`, `kbd` с foreground7% gray fill, неактивные labels внутри PR segmented background, а также muted hover labels на accent.

**Минимальная правка:** selected primary label → `var(--foreground)`; selected secondary/shortcut/segmented-muted text → локальный neutral role уровня zinc600 `#52525b` (или existing secondary foreground). Hover обычных tabs/worktrees → foreground. Не менять semantic success/error и не усиливать все неактивные иконки: их threshold3:1 уже соблюдён. Disabled controls не включаются в обязательный normal-text contrast.

**Проверка:** нормальный текст на фактических backgrounds≥4.5:1; новые selected/hover palette snapshot и PR segmented остаются нейтральными. У T3 роль muted берётся как исходная база, но её нельзя без проверки использовать на каждом сером fill.

## Что уже подтверждено снимками и кодом

- [Workspace](test-results/ui-recheck-1/workspace.png): читабельный редактор и terminal, одинаковые left/right tab roles, спокойный остров без дубля branch header.
- [Action dialog](test-results/ui-recheck-1/action-dialog.png):20px title,14px controls, ясные labels и focus; нет случайного decorative logo.
- [Git menu](test-results/ui-recheck-1/git-menu.png): menu вынесено в Portal, не режется island scroll и имеет нормальный14px текст.
- [Welcome](test-results/ui-recheck-1/welcome.png) и [empty editor](test-results/ui-recheck-1/editor-empty.png): спокойные surfaces, понятные действия; нет Georgia italic `s` и случайных slogan headings.
- [PR Summary](test-results/ui-recheck-1/pr-summary.png), [Timeline](test-results/ui-recheck-1/pr-timeline.png), [Code](test-results/ui-recheck-1/pr-code.png): единый header/segmented/content layout, читаемый prose и mono diff.
- Shared mono token реально читается Monaco и Canvas; Terminal13px используется и при `measureGhosttyCell`, и в renderer. Root16px не масштабирует Canvas второй раз.
- Menu/focus, main tab keyboard и PR keyboard проверены родительским e2e до момента последнего сообщения. Полный e2e на момент ревью ещё не завершился: родитель исправляет доступное имя collapsed Expand actions и повторяет финальное recovery.

## Граница этой проверки

Реализация не менялась этим reviewer. Полный e2e, packaged app,12worktree/12terminal combined soak, screen-reader session, реальный GitHub и T3 runtime Appearance не запускались мной. Проверка трёх исправлений требует новых актуальных снимков/кода; оценки нельзя повышать заранее по обещанию правки.

После этих трёх локальных исправлений ожидается повторная оценка минимум8, но этот документ фиксирует именно проверенную версию с минимумом7.
