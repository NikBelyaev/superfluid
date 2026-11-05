# Superfluid: финальная проверка UI

Дата: 5 ноября 2026. Независимая проверка после исправлений из [UI_RECHECK.md](UI_RECHECK.md).

**Результат: минимум 8/10 по всем восьми критериям. Три замечания предыдущего прохода закрыты.** В проверенном наборе экранов нет оставшихся блокеров этого UI-прохода. Дополнительный декоративный редизайн не требуется.

Это оценка визуального и UX-прохода alpha, а не готовности полной IDE или сертификация доступности.

## Оценки

| Критерий | Исходный UI | Первый recheck | Финал | Основание |
|---|---:|---:|---:|---|
| Читаемая типографика | 4 | 9 | **9** | Читаемые основные действия 13–14 px, вторичный текст 12 px; согласованные sans/mono stacks, веса 400/500/600. Dialog и PR body больше не выглядят уменьшенными относительно редактора. |
| Соответствие визуальному языку T3 | 5 | 8 | **8** | Нейтральные zinc-поверхности, спокойные borders, общий tab recipe и island rows 13/20 px с 16 px icons. Сохранён собственный IDE layout, без чужого AI sidebar и декоративных эффектов. |
| Иерархия и отсутствие шума | 5 | 9 | **9** | Worktree strip остаётся постоянно видимым; убраны многократные повторы ветки, отдельный sidebar footer и дублирующая шапка острова. Редактор остаётся главным содержимым. |
| Геометрия и консистентность | 5 | 8 | **8** | Основные контролы, вкладки, остров, формы и меню используют согласованную геометрию. Left/right tab headers устроены одинаково; divider визуально тонкий, с расширенной hit area. |
| Рабочая поверхность IDE | 6 | 7 | **8** | На новом снимке 1280×800 Plus/Expand/Hide целиком видны справа, независимо от прокрутки вкладок. Остров помещается в editor viewport, collapse и Stop доступны; активная вкладка остаётся видимой при сужении. |
| Управление и обратная связь | 6 | 7 | **8** | Git menu использует Base UI Portal и keyboard interaction. Вкладки файлов имеют ручную активацию, PR — автоматическую. Неподдержанные B/T/F/D/P keycaps удалены; Expand actions имеет явное доступное имя. |
| Доступность и контраст | 5 | 7 | **8** | Проблемные selected/shortcut/segmented/hover text roles усилены локально. Focus видим, размеры основных контролов достаточны для desktop. Полная screen-reader проверка не выполнялась. |
| Сохранение отзывчивости | 8 | 8 | **8** | Нет blur/spring, новых per-row observers или React state с текстом редактора. Tab reveal использует по одному ResizeObserver на полосу. Предоставленный полный Electron smoke завершился с errors[] и p95 6,1 мс на 30 тёплых переключениях. |

## Закрытие прежних замечаний

**1. Toolbar больше не уезжает вместе с вкладками.** Проверены текущие `Workspace.tsx`, `Surfaces.tsx`, `tabs.ts` и CSS. `.editor-header`/`.surface-header` содержат отдельно scrollable tablist (`flex:1; min-width:0; overflow-x:auto`) и `.tab-tools` (`flex:none`). Новый [снимок 1280×800](test-results/workspace-1280.png) показывает полностью доступные Plus/Expand/Hide. Активная PR-вкладка видима, а начало длинной полосы может штатно прокручиваться. В e2e есть проверки границ Hide и активной вкладки после resize.

**2. Launcher не обещает неподдержанные shortcuts.** Текущий `SurfaceLauncher` больше не содержит B/T/F/D/P или соответствующих `<kbd>`. Сохранены названия действий и доступные имена кнопок. Буквы не перехватываются в Monaco. Этот вывод проверен по реализации; отдельный новый снимок launcher в данном финальном проходе не получен.

**3. Контраст на серых подложках исправлен.** В `theme.css` появился локальный `--control-muted-foreground: #52525b`. Он используется для kbd и неактивных PR segmented labels. Selected palette primary стал `--foreground`, selected secondary — control-muted; tab/worktree hover использует foreground, project hover — zinc50. Проверены текущие правила, включая последнюю точечную правку hover metadata острова, применённую родителем во время этого ревью.

| Контекст | Цвет текста | Фон | Расчётный contrast |
|---|---|---|---:|
| Muted на обычной белой поверхности | `#71717a` | `#fff` | 4,83:1 |
| Muted на sidebar | `#71717a` | `#fafafa` | 4,63:1 |
| Control-muted на accent | `#52525b` | `#f4f4f5` | 7,03:1 |
| Hover metadata острова | `#52525b` | white + black 3,5% | 7,16:1 |
| Kbd | `#52525b` | примерно `#efeff0` | около 6,7:1 |

Последний hover fix подтверждён чтением `.island-row:hover small` и `.island-row:hover .change-count`, а не новым hover-снимком. Selected palette также проверена по CSS: предоставленный palette screenshot показывает empty state. Disabled controls и декоративные дублирующие initials не считаются normal text в этой оценке.

## Что проверено непосредственно

Просмотрены реальные новые Electron-снимки: [workspace](test-results/workspace.png), [1280×800](test-results/workspace-1280.png), [palette](test-results/file-palette.png), [PR Summary](test-results/pr-summary.png), [action dialog](test-results/action-dialog.png), [Git menu](test-results/git-menu.png), [welcome](test-results/welcome.png), [empty editor](test-results/editor-empty.png). Проверены текущие UI tokens, headers, launcher, tab helper, contrast rules и соответствующие e2e assertions.

Сверены исходные T3 font stacks в `apps/web/src/appearanceFonts.ts` и island recipe в `apps/web/src/components/chat/threadDetailsPanelStyles.ts`, revision `337c5858c33bc7f8f6dfd391a2c279fa0f7e4d17`. Буквальные фрагменты, точные пути, исходный план и границы адаптации сохранены в [UI_REVIEW.md](UI_REVIEW.md); MIT provenance — в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

На момент делегированного ревью `test-results/smoke-metrics.json` содержал 30 samples, p50 4,4 мс, p95 6,1 мс и errors[]. Родитель сообщил об успешном полном e2e после основных исправлений, включая menu/tab keyboard, PR fixture, narrow geometry, collapse/expand, browser isolation и recovery с caret. В этом read-only проходе я не запускал e2e повторно; последний hover-only fix появился после этого прогона.

Не проверены мной: новая packaged-сборка, T3 runtime Appearance пользователя, полный screen-reader сценарий, реальные GitHub-операции и combined 12-worktree/12-terminal soak. Эти границы не позволяют трактовать оценки как гарантию всех performance/release gates.

## Дополнение исполнителя после ревью

Финальная macOS arm64 сборка `release/mac-arm64/Superfluid.app` прошла полный расширенный Electron e2e с exit code 0, включая штатный выход, повторный запуск и восстановление текста/курсора. Последний packaged smoke: 30 samples, p50 4,6 мс, p95 5,5 мс, errors[]. Текущий `test-results/smoke-metrics.json` относится к этому более позднему прогону.

Проверка сборки обнаружила гонку поздних Pyright-сообщений при остановке сервера. Отдельный regression-тест воспроизвёл исключение до правки; после изоляции поздних сообщений и ошибок stdin проходят все 24 core-теста. Typecheck, lint, format и packaging также прошли. Эта небольшая серверная правка не меняла оценённый UI. Оценки выше принадлежат независимому делегату; это дополнение фиксирует только последующую проверку исполнителя.
