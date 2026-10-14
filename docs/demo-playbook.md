# 離線 Demo 講解手冊

打開 `http://127.0.0.1:8787/?demo=1`，或執行 `npm run demo:preview` 後打開 `http://127.0.0.1:8788/?demo=1`。選故事後按「下一階段」，也可點時間線跳到指定階段。

目前共 **48 個故事、384 個階段、496 條知識記錄、14 張實景歷史參考照片**。所有圖片與 JSON 已落地，演示無需模型 Key。

## 王先生完整示範

王先生 Mr Wang使用手動輪椅，不能走樓梯；今天下雨，要從希慎廣場出發。途中遇到設施故障，改道後利用店舖或設施名稱確認位置，最後前往PopCorn 2。

人物、下雨、故障、定位描述和 agent 返回都是預設演示情境；原始底圖來源、額外情境邊及圖片來源分開保存。醫療背景是故事動機，本例目標是公共走廊會合點，不把未收錄的診所虛構為地圖終點。

| 階段 | 王先生說／情境 | 系統處理 | 剩餘步行 | 設施 | 露天距離 |
| --- | --- | --- | --- | --- | --- |
| 人物與原路線 | 王先生 Mr Wang要從希慎廣場前往PopCorn 2。 | 赴目的地附近的預約門診；示範到建築公共走廊，門診入口不在地圖內。先展示未加入個人需求的原路線。 | 141 m | 演示樓梯 | 48 m |
| 解析出行需求 | 我使用手動輪椅，不能走樓梯，請幫我規劃。 | 意圖結果更新出行類型、避樓梯及陡坡條件，再用現有地圖重新求路。 | 143 m | Lift A | 48 m |
| 下雨與有蓋偏好 | 現在下雨了，我想盡量在室內或有蓋地方行。 | 天氣來自演示情境；意圖結果加入有蓋偏好。比較露天距離，若現有圖沒有更好的替代線，保留原路。 | 158 m | Lift A | 0 m |
| 報告設施故障與改道 | Lift A顯示維修中，不能使用。 | 將演示故障對應到 Lift A 的 facility ID，封閉後重新規劃替代線。 | 164 m | Lift B | 0 m |
| 迷路後用照片／描述找位置 | 我好像走錯了，旁邊看到「Apple, Causeway Bay」和 G/F 樓層標誌。 | 名稱與官方 POI 比對，取同層公共節點作近似候選；本例使用者確認該位置後繼續導航。實景參考照片未提供精確拍攝節點。 | 65 m | 無 | 0 m |
| 生成下一段導航指引 | 請告訴我下一步怎麼走。 | 由重新規劃後的第一路段生成預設粵語句子，語音服務與文字生成分開。 | 65 m | 無 | 0 m |
| 接駁到目的建築 | 我已到銅鑼灣站接駁點，接下來到將軍澳站。 | 兩端步行路線已備好；中間公共交通是接駁敘事，沒有虛構班次或站間導航。 | 562 m | Lift A | 0 m |
| 完成剩餘步行與到達 | 我跟著路線到達PopCorn 2的公共走廊會合點。 | 赴目的地附近的預約門診；示範到建築公共走廊，門診入口不在地圖內。剩餘步行完成；到達節點與目的節點相同。 | 0 m | 無 | 0 m |

第一階段是未考慮通行需求的最短距離比較，之後用相同路由引擎加上無台階、雨天和事件策略。後段接駁切換到另一個場景，表格距離指當前場景的剩餘步行。到達後距離為 0。

照片中店舖外觀與例子中口述線索分開展示。Apple、KFC 知識記錄來自官方 POI，並核對了 [Apple 正式頁面](https://www.apple.com/hk/en/retail/causewaybay/) 和 [PopCorn 的 KFC 頁面](https://www.popcorntko.com.hk/en/dining/bltd1123c2523189cab)。同層近似節點需用戶確認；不把歷史照片當作已標定的攝影視角。

## 場景覆蓋

| 起點場景 | 故事數 | 需求後換線 | 雨天換線 | 故障後 |
| --- | --- | --- | --- | --- |
| 希慎廣場 | 4 | 4 | 4 | 切換替代線 |
| PopCorn 2 | 4 | 4 | 4 | 切換替代線 |
| 又一城・九龍塘站天橋 | 4 | 4 | 0 | 改走緩坡通道 |
| 石硤尾邨服務設施大樓 | 4 | 4 | 4 | 切換替代線 |
| 長沙灣政府合署 | 4 | 4 | 4 | 切換替代線 |
| 沙田政府合署 | 4 | 4 | 4 | 切換替代線 |
| 北角政府合署 | 4 | 4 | 4 | 切換替代線 |
| 北河街市政大廈 | 4 | 4 | 4 | 切換替代線 |
| 渣華道市政大廈 | 4 | 4 | 4 | 切換替代線 |
| 九龍城市政大廈 | 4 | 4 | 4 | 切換替代線 |
| 大埔墟街市及熟食中心 | 4 | 4 | 4 | 切換替代線 |
| 葵興政府合署 | 4 | 4 | 4 | 切換替代線 |

各場景都有 Mr Wang（輪椅）、Ms Chan（25 公斤行李）、Mr Lee（膝蓋不便）、Ms Lam（嬰兒車）4 個人物版本。九龍塘原線已有蓋，雨天保留同線；故障時改走緩坡通道，所有人物故事均可继续到達。

## 素材歸屬

| 圖片 | 作者 | 授權 | 拍攝時間 |
| --- | --- | --- | --- |
| [HK CWB Hysan Place Apple Store sales shop floor June 2021 A12pro 04.jpg](https://commons.wikimedia.org/wiki/File:HK_CWB_Hysan_Place_Apple_Store_sales_shop_floor_June_2021_A12pro_04.jpg) | PioRocWB663 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 2021-06-26 |
| [PopCorn 2 KFC inside 07-06-2023.jpg](https://commons.wikimedia.org/wiki/File:PopCorn_2_KFC_inside_07-06-2023.jpg) | LN9267 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 2023-06-07 16:04:41 |
| [Taste Supermarket Festival Walk Interior 201903.jpg](https://commons.wikimedia.org/wiki/File:Taste_Supermarket_Festival_Walk_Interior_201903.jpg) | Wpcpey | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 2019-03 |
| [Shek Kip Mei Estate Ancillary Facilities Block in May 2021.jpg](https://commons.wikimedia.org/wiki/File:Shek_Kip_Mei_Estate_Ancillary_Facilities_Block_in_May_2021.jpg) | 姒姓賢寧 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 2021-05-17 16:32:48 |
| [Cheung Sha Wan Government Offices.JPG](https://commons.wikimedia.org/wiki/File:Cheung_Sha_Wan_Government_Offices.JPG) | Exploringlife | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 2014-08-10 15:35:03 |
| [HK ShaTin Government Offices Enterance.jpg](https://commons.wikimedia.org/wiki/File:HK_ShaTin_Government_Offices_Enterance.jpg) | WiNG | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) | 7 March 2008, 16:34:30 (according to Exif data) |
| [North Point Government Offices 201506.jpg](https://commons.wikimedia.org/wiki/File:North_Point_Government_Offices_201506.jpg) | Wing1990hk | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) | 2015-06-29 |
| [Pei Ho Street Municipal Services Building 201609.jpg](https://commons.wikimedia.org/wiki/File:Pei_Ho_Street_Municipal_Services_Building_201609.jpg) | Wpcpey | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 2016-09-17 |
| [Java Road Municipal Services Building (blue sky).jpg](https://commons.wikimedia.org/wiki/File:Java_Road_Municipal_Services_Building_(blue_sky).jpg) | Exploringlife | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 2016-09-13 14:54:49 |
| [Kowloon City Municipal Services Building (full view).jpg](https://commons.wikimedia.org/wiki/File:Kowloon_City_Municipal_Services_Building_(full_view).jpg) | Exploringlife | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 2016-11-04 14:48:36 |
| [HK TPD 大埔 Tai Po Wan Tau Street 大埔墟街市及熟食中心 Tai Po Hui Market and Cooked Food Centre December 2023 R12S 15.jpg](https://commons.wikimedia.org/wiki/File:HK_TPD_%E5%A4%A7%E5%9F%94_Tai_Po_Wan_Tau_Street_%E5%A4%A7%E5%9F%94%E5%A2%9F%E8%A1%97%E5%B8%82%E5%8F%8A%E7%86%9F%E9%A3%9F%E4%B8%AD%E5%BF%83_Tai_Po_Hui_Market_and_Cooked_Food_Centre_December_2023_R12S_15.jpg) | Kitgor Shiklap Poerw | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) | 2023-12-10 11:37:16 |
| [Kwai Hing Government Offices.jpg](https://commons.wikimedia.org/wiki/File:Kwai_Hing_Government_Offices.jpg) | Exploringlife | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 2015-05-14 15:03:47 |
| [Hysan Place Apple Store 201405.jpg](https://commons.wikimedia.org/wiki/File:Hysan_Place_Apple_Store_201405.jpg) | Wing1990hk | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) | 2014-05-26 |
| [PopCorn 2 KFC 07-06-2023.jpg](https://commons.wikimedia.org/wiki/File:PopCorn_2_KFC_07-06-2023.jpg) | LN9267 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | 2023-06-07 16:20:31 |

完整原始來源、素材本地路徑和索引在 `data/demo/media.json`。生成路線位置图不冒充現場照片；故障告示標明「演示告示」。

## 資料與代碼邊界

`shared/demo/provider.ts` 定義例子返回；`frontend/src/api/genai.ts` 處理 API 呼叫；兩者共用 `WorkflowClient`。`shared/demo/navigation.ts` 處理套用結果和求路，UI 在 `frontend/src/components/DemoLibrary.tsx`。

`data/knowledge` 是可檢索的名稱／樓層／坐標知識庫；線上定位也已讀入這些店舖候選。`GET /api/knowledge/hysan-place?q=Apple` 可獨立查詢，完全不需要模型。近似店舖候選分數上限 0.79，須確認後再改變位置。

再生成例子：`npm run demo:build`；同步並構建：`npm run build`。原始场景文件不包含演示樓梯／有蓋假設，這些單獨放在 `data/demo/overlays.json`。
