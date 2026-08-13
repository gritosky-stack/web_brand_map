import Foundation

enum RouteStore {

    // MARK: - Completed
    static let completedRoutes: [Route] = [
        Route(
            id: "route_0", gpxFile: "Samari - Lastra", gpxSubdir: nil,
            name: "Samari - Lastra", type: .completed,
            date: "2026-03-01",
            description: "Мы проделали еще один классный маршрут — от Самари до Ластры и вышло офигенно!)\nПогода была просто супер: чистое небо и солнышко, снег почти весь растаял, только выше 1000 метров еще лежит.\nБыло очень красиво, видели четырех оленей 🦌, горы на горизонте.\n\nПо итогу:\n• Прошли 22.6 км вместо 21.5\n• Общее время с паузами: 6:27\n• Чистой ходьбы: 5:18 🥾\n\nВсе держались просто супер, темп был классный! Добрались до станции за 30-35 минут до отправления. 🚂",
            instagramUrl: nil,
            photos: ["photos/Samari - Lastra/IMG_6806.JPG", "photos/Samari - Lastra/IMG_6817.JPG"],
            overrideAscent: 718, overrideDescent: 829, overrideTime: "6h 24m", overrideMinEle: nil
        ),
        Route(
            id: "route_1", gpxFile: "Gvozdacke Stene", gpxSubdir: nil,
            name: "Gvozdačke Stene", type: .completed,
            date: "2026-03-08",
            description: "Классно сходили, виды со скал были просто нереальные!!",
            instagramUrl: nil,
            photos: [
                "photos/Gvozdacke Stene/IMG_7332.JPG", "photos/Gvozdacke Stene/IMG_7382.JPG",
                "photos/Gvozdacke Stene/IMG_7387.JPG", "photos/Gvozdacke Stene/IMG_7425.JPG",
                "photos/Gvozdacke Stene/IMG_7466.JPG"
            ],
            overrideAscent: 726, overrideDescent: 730, overrideTime: "6h 07m", overrideMinEle: nil
        ),
        Route(
            id: "route_2", gpxFile: "Lastra - Divcibare", gpxSubdir: nil,
            name: "Lastra - Divčibare", type: .completed,
            date: "2026-03-15",
            description: "Маршрут от ЖД станции Ластра с резким набором и хвойными лесами Дивчибаре.\nБыло классно 🔥",
            instagramUrl: nil,
            photos: [
                "photos/Lastra - Divcibare/IMG_7564.JPG", "photos/Lastra - Divcibare/IMG_7572.JPG",
                "photos/Lastra - Divcibare/IMG_7580.JPG"
            ],
            overrideAscent: 604, overrideDescent: 587, overrideTime: "5h 43m", overrideMinEle: nil
        ),
        Route(
            id: "route_3", gpxFile: "Samari - Magles - Pali", gpxSubdir: nil,
            name: "Samari - Magleš (Pali)", type: .completed,
            date: "2026-02-14",
            description: "🏔️ Маглеш (1036м): 21 км снежного безумия!\n\nМы не ожидали такой глубины — снег таял прямо в ботинках, но темп задали такой, что горы горели!\n\nГлавным героем дня стал 69-летний Зоран: легенда хайкинга, который знает каждую тропу и заброшенную хижину в районе Вальево как свои пять пальцев.\n\nВместе форсировали полноводную реку Забаву и пробирались через заснеженные леса. Встретили местную жительницу: пугала медведями 🐻 и настойчиво пыталась напоить ракией 🥃\n\nСпускались в густом тумане 🌫️, но успели запрыгнуть в уходящий поезд 🚂💨",
            instagramUrl: "https://www.instagram.com/reel/DVZryC5CLZp/",
            photos: [
                "photos/Samari - Magles - Pali/IMG_6278.JPG", "photos/Samari - Magles - Pali/IMG_6312.JPG",
                "photos/Samari - Magles - Pali/IMG_6317.JPG", "photos/Samari - Magles - Pali/IMG_6360.JPG",
                "photos/Samari - Magles - Pali/IMG_6408.JPG", "photos/Samari - Magles - Pali/IMG_6427.JPG",
                "photos/Samari - Magles - Pali/IMG_6435.JPG", "photos/Samari - Magles - Pali/IMG_6448.JPG",
                "photos/Samari - Magles - Pali/IMG_6451.JPG", "photos/Samari - Magles - Pali/IMG_6495.JPG",
                "photos/Samari - Magles - Pali/IMG_6502.JPG"
            ],
            overrideAscent: 805, overrideDescent: 805, overrideTime: "7h", overrideMinEle: nil
        ),
        Route(
            id: "route_4", gpxFile: "Medednik - Bucurska pecina", gpxSubdir: nil,
            name: "Medednik - Bućurska Pećina", type: .completed,
            date: "2026-03-07",
            description: "Живописный маршрут, посетили пещеру, залезли на крутой склон Медведника, наделали кучу фоток, прошли по гребню и спустились через красивый лес.\n\nУвидели закат, в конце спускались в темноте с фонариками.",
            instagramUrl: nil,
            photos: [
                "photos/Medednik - Bucurska pecina/IMG_7045.JPG", "photos/Medednik - Bucurska pecina/IMG_7146.JPG",
                "photos/Medednik - Bucurska pecina/IMG_7257.JPG", "photos/Medednik - Bucurska pecina/IMG_7281.JPG",
                "photos/Medednik - Bucurska pecina/IMG_7287.JPG", "photos/Medednik - Bucurska pecina/IMG_7299.JPG",
                "photos/Medednik - Bucurska pecina/IMG_7306.JPG"
            ],
            overrideAscent: 1267, overrideDescent: 1272, overrideTime: "8h 25m", overrideMinEle: nil
        ),
        Route(
            id: "route_5", gpxFile: "Valjevo - Gradac River Canyon", gpxSubdir: nil,
            name: "Valjevo - Gradac River Canyon", type: .completed,
            date: "2026-02-02",
            description: "Один из первых маршрутов, поезд до Вальево, прошли через город к реке Градац. Шли вдоль реки, видели оленя, зашли на тропу со значком опасности.\n\nПуть оказался узким с крутым склоном справа. Успешно его пройдя оказались рядом с этно-деревней. Встретили очень красивый монастырь Челие.",
            instagramUrl: "https://www.instagram.com/reel/DUUDzPiCBbM/",
            photos: [],
            overrideAscent: 301, overrideDescent: 382, overrideTime: "4h", overrideMinEle: 171
        ),
        Route(
            id: "route_6", gpxFile: "Istocni Maljen - Mokra Pecina", gpxSubdir: nil,
            name: "Istoćni Maljen - Mokra Pećina", type: .completed,
            date: "2026-02-15",
            description: "🏔 Массив Мальен: 24 км дикой Сербии, олени и ночной финиш\n\n📊 Цифры:\n• Дистанция: 24 км\n• Набор высоты: 931 м\n• Время в пути: 8 часов (6.5 ч чистого движения)\n• Старт от церкви Св. Георгия\n\nНа старте из-под носа сорвались два оленя, позже заснял убегающую лисицу.\n\nПещера Мокра Печина: из неё вытекает ледяной ручей, внутри слышен гул водопадов. С хребта при ясной погоде разглядели Авалу и Космай.\n\n🏆 Главный герой: собака Тиша. Мы прошли 24 км, её GPS-ошейник насчитал 39.4 км.",
            instagramUrl: "https://www.instagram.com/reel/DUy8LHWiO0d/",
            photos: [
                "photos/Maljen/IMG_5753.JPG", "photos/Maljen/IMG_5819.JPG", "photos/Maljen/IMG_5837.JPG",
                "photos/Maljen/IMG_5852.JPG", "photos/Maljen/IMG_5888.JPG", "photos/Maljen/IMG_5975.JPG",
                "photos/Maljen/IMG_5999.JPG", "photos/Maljen/IMG_6033.JPG"
            ],
            overrideAscent: 931, overrideDescent: 935, overrideTime: "7h 57m", overrideMinEle: nil
        ),
        Route(
            id: "route_7", gpxFile: "Бељаница - Богојављенски успон", gpxSubdir: nil,
            name: "Бељаница - Богојављенски успон", type: .completed,
            date: "2026-03-22",
            description: "Очень красивый и одновременно сложный маршрут. Оставили машину недалеко от реки, прошли до деревни к водопаду Велики Бук, а затем начали подъем.\n\nНаверху было холодно и дул сильный ветер, кусты и ветки деревьев были в горизонтальных сосульках от ветра. Мы быстро прошли до вершины, оказались выше некоторых облаков, наделали фоток и сразу начали спуск.\n\nПочти в самом конце мы зашли на видиковац невероятной красоты, с видом на каньон.",
            instagramUrl: nil,
            photos: [
                "photos/Бељаница - Богојављенски успон/IMG_7799.JPG",
                "photos/Бељаница - Богојављенски успон/IMG_7805.JPG",
                "photos/Бељаница - Богојављенски успон/IMG_7828.JPG",
                "photos/Бељаница - Богојављенски успон/IMG_7891.JPG"
            ],
            overrideAscent: 1105, overrideDescent: 1119, overrideTime: "5h 51m", overrideMinEle: nil
        ),
        Route(
            id: "route_8", gpxFile: "Ovcar", gpxSubdir: nil,
            name: "Ovčar", type: .completed,
            date: "2026-04-19",
            description: "Круговой маршрут по горе Овчар — одной из жемчужин Западной Сербии. Стартовали от Овчар Бани и начали подъём через густые леса.\n\nПо пути прошли мимо монастыря Свети Тројице — одного из монастырей Овчарско-Кабларского ущелья, иногда называемого «Сербским Афоном». В монастыре Сретење нас угостили кофе и сладостями.\n\nС вершины открывались виды на ущелье реки Западная Морава и окрестные горы.",
            instagramUrl: nil,
            photos: [
                "photos/Ovcar/IMG_8743.JPG", "photos/Ovcar/IMG_8768.JPG",
                "photos/Ovcar/IMG_8772.JPG", "photos/Ovcar/IMG_8782.JPG",
                "photos/Ovcar/IMG_8846.JPG", "photos/Ovcar/IMG_8870.JPG",
                "photos/Ovcar/IMG_8878.JPG"
            ],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "route_10", gpxFile: "Debelo Brdo - Jablanik", gpxSubdir: nil,
            name: "Debelo Brdo - Jablanik", type: .completed,
            date: "2026-05-02",
            description: "Интересный маршрут. Было довольно людно, встречали группы от 2 до 15 человек.\n\nОт Дебело Брдо до верха Ябланика дорога не сложная, уклон небольшой и не постоянный. По дороге к вершине проходим через красивый лес, сквозь деревья видно Гвождачке Стене — внушительные скалы с обрывом на 400+ метров к реке Дрина и границе Сербии.\n\nНа вершине Ябланика может задувать ветерок, так что рекомендую взять с собой ветровку. Вид с вершины открывается впечатляющий: видно зелёные холмистые равнины на горизонте, гору Медведник, Велики Повлен, Гвождачке Стене и много других горных вершин неподалёку.\n\nСпуск с вершины иногда крутой, но тоже очень красивый. Спустившись попадаем к речушке Ябланица — с чистой водой и небольшим течением.\n\nМаршрут предполагает переход реки 2–3 раза, будьте готовы. В сухую погоду непромокаемой обуви будет достаточно.\n\nОт реки Ябланица необходимо подняться обратно к Дебело Брдо — 2 варианта: короткий но крутой, или длинный но пологий. В идеале идти наоборот: сначала спуск к реке, затем подъём на Ябланик — так будет комфортнее.",
            instagramUrl: nil,
            photos: [
                "photos/Debelo Brdo - Jablanik/jablanik1.JPG",
                "photos/Debelo Brdo - Jablanik/jablanik2.JPG",
                "photos/Debelo Brdo - Jablanik/jablanik3.JPG",
                "photos/Debelo Brdo - Jablanik/jablanik4.JPG",
                "photos/Debelo Brdo - Jablanik/jablanik5.JPG",
                "photos/Debelo Brdo - Jablanik/jablanik6.JPG",
                "photos/Debelo Brdo - Jablanik/jablanik7.JPG",
                "photos/Debelo Brdo - Jablanik/jablanik8.JPG",
                "photos/Debelo Brdo - Jablanik/jablanik9.JPG",
                "photos/Debelo Brdo - Jablanik/jablanik10.JPG",
                "photos/Debelo Brdo - Jablanik/jablanik11.JPG",
                "photos/Debelo Brdo - Jablanik/jablanik12.JPG",
            ],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "route_9", gpxFile: "Lastra - Magles - Kusakovici", gpxSubdir: nil,
            name: "Lastra - Magleš - Kušakovići", type: .completed,
            date: "2026-02-08",
            description: "Один из первых походов, доехал до ЖД станции Ластра, прошел чуть вдоль реки и начал подъем в гору.\n\nМоментами тропа терялась и приходилось проходить через ветки и кустарник. Встречалось много заброшенных хижин. На последних 200 метрах набора высоты тропа совсем потерялась и я шел по дикому по заросшим мхом камням.\n\nПосле вершины вышел на открытый участок с классным видом, начал спуск к станции Ластра и по пути наткнулся на деревню Кушаковичи.",
            instagramUrl: "https://www.instagram.com/reel/DUjkxYiiBu-/",
            photos: [
                "photos/Lastra - Magles - Kusakovici/IMG_5170.JPG", "photos/Lastra - Magles - Kusakovici/IMG_5216.JPG",
                "photos/Lastra - Magles - Kusakovici/IMG_5238.JPG", "photos/Lastra - Magles - Kusakovici/IMG_5265.JPG",
                "photos/Lastra - Magles - Kusakovici/IMG_5320.JPG", "photos/Lastra - Magles - Kusakovici/IMG_5334.JPG",
                "photos/Lastra - Magles - Kusakovici/IMG_5339.JPG", "photos/Lastra - Magles - Kusakovici/IMG_5358.JPG",
                "photos/Lastra - Magles - Kusakovici/IMG_5396.JPG", "photos/Lastra - Magles - Kusakovici/IMG_5408.JPG",
                "photos/Lastra - Magles - Kusakovici/IMG_5441.JPG", "photos/Lastra - Magles - Kusakovici/IMG_5478.JPG",
                "photos/Lastra - Magles - Kusakovici/IMG_5489.JPG", "photos/Lastra - Magles - Kusakovici/IMG_5498.JPG",
                "photos/Lastra - Magles - Kusakovici/IMG_5506.JPG"
            ],
            overrideAscent: 987, overrideDescent: 986, overrideTime: "5h", overrideMinEle: 365
        ),
        Route(
            id: "route_11", gpxFile: "Ostrvica", gpxSubdir: nil,
            name: "Ostrvica", type: .completed,
            date: "2026-05-09",
            description: "Острвица — приметная коническая вершина (760 м) в районе горы Рудник в Шумадии, увенчанная руинами средневековой крепости.\n\nМаршрут короткий, но крутой: почти весь набор высоты (≈390 м) укладывается в пару километров — вверх по склону конуса практически без передышки. На вершине сохранились остатки крепостных стен, а вокруг открывается круговая панорама на холмы Шумадии и массив Рудника.\n\n📊 Маршрут: ~2 км, набор ≈390 м, вершина 760 м.",
            instagramUrl: nil,
            photos: [
                "photos/Ostrvica/ostrvica1.JPG", "photos/Ostrvica/ostrvica2.JPG",
                "photos/Ostrvica/ostrvica3.JPG", "photos/Ostrvica/ostrvica4.JPG",
                "photos/Ostrvica/ostrvica5.JPG", "photos/Ostrvica/ostrvica6.JPG",
                "photos/Ostrvica/ostrvica7.JPG", "photos/Ostrvica/ostrvica8.JPG",
                "photos/Ostrvica/ostrvica9.JPG", "photos/Ostrvica/ostrvica10.JPG"
            ],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "route_12", gpxFile: "Maglic - Stolovi", gpxSubdir: nil,
            name: "Maglić - Stolovi", type: .completed,
            date: "2026-05-10",
            description: "Кольцевой маршрут по массиву Столови недалеко от Кралево — горному хребту над долиной реки Ибар.\n\nСнизу почти весь набор (≈960 м) накручивается по лесистым склонам, выводя к скальным выходам и открытым гребням, которыми славятся Столови. С верхней части маршрута открываются широкие виды на окрестные хребты Западной Сербии.\n\n📊 Маршрут кольцевой: ~9 км, набор ≈960 м, верх ≈900 м.",
            instagramUrl: nil,
            photos: [
                "photos/Maglic - Stolovi/maglic1.JPG", "photos/Maglic - Stolovi/maglic2.JPG",
                "photos/Maglic - Stolovi/maglic3.JPG", "photos/Maglic - Stolovi/maglic4.JPG",
                "photos/Maglic - Stolovi/maglic5.JPG", "photos/Maglic - Stolovi/maglic6.JPG",
                "photos/Maglic - Stolovi/maglic7.JPG", "photos/Maglic - Stolovi/maglic8.JPG",
                "photos/Maglic - Stolovi/maglic9.JPG", "photos/Maglic - Stolovi/maglic10.JPG",
                "photos/Maglic - Stolovi/maglic11.JPG"
            ],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "route_13", gpxFile: "Dzherdzhap - Ploce - Veliki Strabac", gpxSubdir: nil,
            name: "Đerdap - Ploče - Veliki Štrbac", type: .completed,
            date: "2026-05-30",
            description: "Стартовали от парковки у дороги. Приехали в национальный парк Джердап с организацией «Srbija za Mlade».\n\nПодъём начали рано утром, почти весь маршрут проходит через лес — что очень классно в жаркие дни. Для групп обязательно сопровождение рейнджеров, которые также могут довезти до основных обзорных точек на Дастерах. Нас сопровождало двое)\n\nГруппа была большая, но мы довольно быстро поднимались и делали привалы каждые час-полтора. Видели много интересных жуков по дороге, лес был очень красивый)\n\nНа вершине и обзорной площадке «Велики Штрбац» открывается безумно красивый вид на Дунай, национальный парк Джердап и Румынию, которая прямо за Дунаем. Дул сильный ветер, пришлось накинуть ветровку.\n\nПосле спустились до ниже расположенного, но не менее красивого обзорного пункта «Плоче». Там соорудили площадку, с которой открывается вид на реку и массивную скалу прямо в ней, а также видно высочайшую точку, с которой мы спустились.\n\nЗатем благополучно спустились обратно и уехали кушать в ресторан 🤤",
            instagramUrl: nil,
            photos: [
                "photos/Dzherdzhap - Ploce - V-Strbac/IMG_0149.JPG", "photos/Dzherdzhap - Ploce - V-Strbac/IMG_0159.JPG",
                "photos/Dzherdzhap - Ploce - V-Strbac/IMG_0210.JPG", "photos/Dzherdzhap - Ploce - V-Strbac/IMG_0213.JPG",
                "photos/Dzherdzhap - Ploce - V-Strbac/IMG_0219.JPG", "photos/Dzherdzhap - Ploce - V-Strbac/IMG_0228.JPG",
                "photos/Dzherdzhap - Ploce - V-Strbac/IMG_0231.JPG", "photos/Dzherdzhap - Ploce - V-Strbac/IMG_0238.JPG",
                "photos/Dzherdzhap - Ploce - V-Strbac/IMG_0252.JPG", "photos/Dzherdzhap - Ploce - V-Strbac/IMG_0253.JPG",
                "photos/Dzherdzhap - Ploce - V-Strbac/IMG_0481.JPG"
            ],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "route_14", gpxFile: "Vrutci Camping V2", gpxSubdir: nil,
            name: "Vrutci Camping", type: .completed,
            date: "2026-06-06",
            description: "Эпичный двухдневный маршрут, сочетающий прогулку по старинной узкоколейке, исследование диких пещер и ночёвку на берегу горного озера. Идеальный выбор для тех, кто хочет сбежать от городской суеты в настоящую сербскую глушь.\n\n🗺️ Ключевые точки:\n• Каньон Джетинья: живописная тропа через 5 скальных туннелей (до 190 м в длину) и освежающие заводи.\n• Пещера Мегара: исследовательская точка с уникальной экосистемой — внутри колонии летучих мышей и сталактиты (нужен фонарь и сменная одежда).\n• Римские руины: возможность прикоснуться к истории прямо на маршруте.\n• Озеро Врутци: масштабная дамба и живописные берега, окружённые холмистым лесом. Лучшее место для атмосферного кемпинга и ночного купания.\n\n✨ Почему стоит выбрать этот маршрут:\n• Разнообразие: смена локаций от археологических объектов до диких пещер и озёрных стоянок.\n• Доступность: старт и финиш доступны на поезде из Белграда (ст. Стапари).\n• Атмосфера: настоящий «дикий» сербский опыт — тишина, лесные звуки, ночные купания и общение с местными жителями.\n\n⚠️ Советы участникам:\n• Безопасность: в регионе обитают медведи (неагрессивные, предпочитают растительную пищу) — соблюдайте базовые правила хранения еды в лагере.\n• Снаряжение: берите фонари для пещеры и удобную трекинговую обувь (маршрут сочетает ровные участки и лесные тропы).\n• Локальное комьюнити: на плотине можно встретить местных охранников (Радэ), которые подскажут актуальную информацию по рыбалке и ситуации на озере.\n\n🚂 Транспорт: поезд «Белград — Стапари» (~4.5 часа в пути).\n💰 Бюджет: ~2 000 RSD со своим снаряжением.",
            instagramUrl: nil,
            photos: [
                "photos/Vrutci Camping/IMG_0495.JPG", "photos/Vrutci Camping/IMG_0557.JPG",
                "photos/Vrutci Camping/IMG_0579.JPG", "photos/Vrutci Camping/IMG_0598.JPG",
                "photos/Vrutci Camping/IMG_0603.JPG", "photos/Vrutci Camping/IMG_0607.JPG",
                "photos/Vrutci Camping/IMG_0616.JPG", "photos/Vrutci Camping/IMG_0633.JPG",
                "photos/Vrutci Camping/IMG_0665.JPG", "photos/Vrutci Camping/IMG_0694.JPG",
                "photos/Vrutci Camping/IMG_0710.JPG"
            ],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        // ── Двухдневные маршруты с ночёвкой ────────────────────────────────────
        // GPX склеен из дневных треков (www/multiday/) скриптом tools/merge_gpx_days.py:
        // внутри файла по одному <trk> на день, GPXParser читает их как единый маршрут.
        Route(
            id: "route_15", gpxFile: "Samari - Dren. Kik Camp", gpxSubdir: nil,
            name: "Samari - Dren. Kik Camp", type: .completed,
            date: "2026-07-19",
            description: "Короткий двухдневный выход с ночёвкой на Дрен. Кик — отличный вариант, когда хочется настоящего кемпинга, но без больших километров.\n\n🥾 День 1 (19.07): от станции Самари вверх, 5.4 км и +452 м набора до места ночёвки на высоте ~800 м. Подъём почти без передышки, зато лагерь встаёт на открытой поляне с видом на лесистые холмы Вальевского края.\n\n🌙 Ночёвка: костёр и закат над долиной.\n\n🥾 День 2 (20.07): спуск обратно к Самари другой тропой — 3.1 км и −350 м. Быстрый выход к станции.\n\n📊 Итого за два дня: 8.5 км, набор ≈483 м, верхняя точка 862 м.\n\n💡 Маршрут отлично подходит для первого кемпинга: короткие переходы, вода и станция рядом, всё снаряжение несётся всего 5 км.",
            instagramUrl: nil,
            photos: [
                "photos/Samari - Dren. Kik Camp/dren_kik_camp1.JPG", "photos/Samari - Dren. Kik Camp/dren_kik_camp2.JPG",
                "photos/Samari - Dren. Kik Camp/dren_kik_camp3.JPG", "photos/Samari - Dren. Kik Camp/dren_kik_camp4.JPG",
                "photos/Samari - Dren. Kik Camp/dren_kik_camp5.JPG", "photos/Samari - Dren. Kik Camp/dren_kik_camp6.JPG",
                "photos/Samari - Dren. Kik Camp/dren_kik_camp7.JPG", "photos/Samari - Dren. Kik Camp/dren_kik_camp8.JPG",
                "photos/Samari - Dren. Kik Camp/dren_kik_camp9.JPG", "photos/Samari - Dren. Kik Camp/dren_kik_camp10.JPG",
                "photos/Samari - Dren. Kik Camp/dren_kik_camp11.JPG", "photos/Samari - Dren. Kik Camp/dren_kik_camp12.JPG",
                "photos/Samari - Dren. Kik Camp/dren_kik_camp13.JPG"
            ],
            overrideAscent: 483, overrideDescent: 481, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "route_16", gpxFile: "Vrutci Camping 2", gpxSubdir: nil,
            name: "Vrutci Camping 2", type: .completed,
            date: "2026-07-25",
            description: "Второй заход на кемпинг у озера Врутци — тот же любимый маршрут через каньон Джетиње, но уже летом и в полную жару.\n\n🥾 День 1 (25.07): от Стапари вдоль старой узкоколейки и через скальные тоннели каньона, дальше подъём лесными тропами к озеру Врутци. 11.7 км, +682 м. Лагерь на берегу озера.\n\n🌙 Ночёвка: костёр и дикие берега Врутци.\n\n🥾 День 2 (26.07): возвращение к Стапари другим вариантом тропы — 11.9 км, +396 м, с длинными открытыми участками и видами на холмы вокруг озера.\n\n📊 Итого за два дня: 23.5 км, набор ≈1078 м, верхняя точка 843 м.\n\n⚠️ Летом на маршруте мало тени на верхних участках — берите запас воды; в районе водятся медведи, еду на ночь убирайте.\n\n🚂 Транспорт: поезд «Белград — Стапари».",
            instagramUrl: nil,
            photos: [
                "photos/Vrutci Camping 2/vrutci_camping_21.JPG", "photos/Vrutci Camping 2/vrutci_camping_22.JPG",
                "photos/Vrutci Camping 2/vrutci_camping_23.JPG", "photos/Vrutci Camping 2/vrutci_camping_24.JPG",
                "photos/Vrutci Camping 2/vrutci_camping_25.JPG", "photos/Vrutci Camping 2/vrutci_camping_26.JPG",
                "photos/Vrutci Camping 2/vrutci_camping_27.JPG", "photos/Vrutci Camping 2/vrutci_camping_28.JPG"
            ],
            overrideAscent: 1078, overrideDescent: 1089, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "route_17", gpxFile: "Samari - Taorske Stene Camp", gpxSubdir: nil,
            name: "Samari - Taorske Stene Camp", type: .completed,
            date: "2026-08-09",
            description: "Двухдневный маршрут от станции Самари к Таорским стенам с ночёвкой на гребне — самый «высокий» кемпинг из наших: лагерь стоит выше 1000 м.\n\n🥾 День 1 (09.08): от Самари (480 м) долгий ровный набор через лес и открытые луга — 11.5 км и +713 м до места ночёвки на 1013 м. Вечером с гребня открывается панорама на десятки километров и очень красивый закат.\n\n🌙 Ночёвка: лагерь на верхней поляне, костёр, утром — заросли ежевики прямо у тропы.\n\n🥾 День 2 (10.08): спуск обратно к Самари — 8.2 км, −656 м, короче и быстрее первого дня.\n\n📊 Итого за два дня: 19.7 км, набор ≈841 м, верхняя точка 1013 м.\n\n💡 Воды наверху нет — весь запас на ночёвку нужно поднимать с собой снизу.",
            instagramUrl: nil,
            photos: [
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp1.JPG",
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp2.JPG",
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp3.JPG",
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp4.JPG",
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp5.JPG",
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp6.JPG",
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp7.JPG",
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp8.JPG",
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp9.JPG",
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp10.JPG",
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp11.JPG",
                "photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp12.JPG"
            ],
            overrideAscent: 841, overrideDescent: 842, overrideTime: nil, overrideMinEle: nil
        ),
    ]

    // MARK: - Planned
    static let plannedRoutes: [Route] = [
        Route(
            id: "future_0", gpxFile: "Dom_Vis-Javoracki-vrh", gpxSubdir: "future_trips",
            name: "Dom Vis - Javorački vrh", type: .planned,
            date: nil, description: nil, instagramUrl: nil, photos: [],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "future_1", gpxFile: "Рудник - Благовештење", gpxSubdir: "future_trips",
            name: "Рудник - Благовештење", type: .planned,
            date: nil, description: nil, instagramUrl: nil, photos: [],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "future_2", gpxFile: "Каблар", gpxSubdir: "future_trips",
            name: "Каблар", type: .planned,
            date: nil, description: nil, instagramUrl: nil, photos: [],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "future_3", gpxFile: "Дивчибаре - Козомор - Црни Врх", gpxSubdir: "future_trips",
            name: "Дивчибаре - Козомор - Црни Врх", type: .planned,
            date: nil, description: nil, instagramUrl: nil, photos: [],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "future_4", gpxFile: "Veliki Krs", gpxSubdir: "future_trips",
            name: "Велики Крш", type: .planned,
            date: nil,
            description: "Велики Крш — легендарный карстовый хребет на востоке Сербии, известный как «Альпы восточной Сербии». Известняковые скалы хребта сформировались 277 миллионов лет назад как доисторический морской риф.\n\nС гребня открываются панорамы на горы Стол, Дели Йован, Хомольские горы и Борское озеро. Хребет известен непредсказуемыми ветрами — пилоты предпочитают его облетать.\n\n📊 Маршрут: 24.2 км, набор 978 м, вершина 1135 м.",
            instagramUrl: nil,
            photos: [
                "future_trips/photos/20210214_143517.jpg",
                "future_trips/photos/Veliki-krs-2-scaled.jpg",
                "future_trips/photos/Veliki-krs-1148-Goran-Stamenkovic-scaled.jpg"
            ],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "future_5", gpxFile: "Велики Вукан", gpxSubdir: "future_trips",
            name: "Велики Вукан", type: .planned,
            date: nil,
            description: "Велики Вукан — самая популярная вершина Хомольских гор. Круговой маршрут через буковые и сосновые леса выводит на вершину с панорамным видом 360°.\n\nПосле похода можно расслабиться в термальном источнике в деревне Ждрело (вода 40°C).\n\n📊 Маршрут: 19.5 км, набор 1272 м, вершина 743 м.",
            instagramUrl: nil,
            photos: [
                "future_trips/photos/Homolje-Veliki-i-Mali-Vukan-1.jpg",
                "future_trips/photos/VELIKI VUKAN_5.jpg"
            ],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "future_6", gpxFile: "Хайдучка, Погана, Миjуциđa caves", gpxSubdir: "future_trips",
            name: "Пещеры: Хайдучка, Погана, Мийучица", type: .planned,
            date: nil,
            description: "Три дикие карстовые пещеры Хомольских гор — настоящее подземное приключение.\n\nХайдучка пещера прячет ледяную подземную реку. Погана пещера удивляет «световым колодцем» — отверстием в потолке. Мийучица — жемчужина маршрута: подземное озеро и мощный карстовый источник, где берёт начало река Комненска.\n\n📊 Маршрут: 17.4 км, набор 827 м.",
            instagramUrl: nil,
            photos: [
                "future_trips/photos/20240406_143023.jpg",
                "future_trips/photos/135226923.400x300.jpg"
            ],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "future_7", gpxFile: "Tornicka_Bobija", gpxSubdir: "future_trips",
            name: "Tornička Bobija", type: .planned,
            date: nil,
            description: "Tornička Bobija (1268 м) — лесистая вершина в сердце западной Сербии. Маршрут петляет через густые буковые леса, пересекая небольшие ручьи и родники — вода здесь буквально везде.\n\nНа подъёме встречаются несколько мощных карстовых источников с ледяной водой. С гребня открываются виды на поросшие лесом холмы Поринья и долину реки Тамнавы.\n\n📊 Маршрут круговой: ~15 км, набор ~530 м. Хорошо подходит для межсезонья.",
            instagramUrl: nil,
            photos: [
                "future_trips/photos/bobija1.jpg",
                "future_trips/photos/bobija2.jpg",
                "future_trips/photos/bobija3.jpg",
                "future_trips/photos/bobija4.jpg",
            ],
            overrideAscent: nil, overrideDescent: nil, overrideTime: nil, overrideMinEle: nil
        ),
        Route(
            id: "future_8", gpxFile: "Maglic-Ciker-Usovica", gpxSubdir: "future_trips",
            name: "Maglić - Čiker - Usovica", type: .planned,
            date: nil,
            description: "Маршрут по горному массиву Столови вблизи Кралево: три вершины — Маглич (1375 м), Чикер и Усовица — одним кольцом.\n\nПлато Столови известен своими скальными выходами, лесами и широкими панорамами на долину Ибра и Кралево. Маршрут разнообразный: крутые подъёмы, открытые гребни, живописные спуски через лес.\n\n📊 Маршрут круговой, ~7 ч в пути, вершина 1375 м.",
            instagramUrl: nil,
            photos: [
                "future_trips/photos/stolovi1.JPG",
                "future_trips/photos/stolovi2.JPG",
                "future_trips/photos/stolovi3.JPG",
                "future_trips/photos/stolovi4.JPG",
            ],
            overrideAscent: nil, overrideDescent: nil, overrideTime: "7h", overrideMinEle: nil
        ),
    ]

    static var all: [Route] { completedRoutes + plannedRoutes }
}
