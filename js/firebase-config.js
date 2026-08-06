/* Ortak oy havuzu (Firebase/Firestore) yapılandırması.
   Kurulum adımları README'nin "Ortak oy havuzu" bölümünde.

   Boş (null) bırakılırsa site tamamen yerel çalışır: oylar yalnızca
   ziyaretçinin tarayıcısında saklanır. Doldurulursa oylar Firestore'daki
   "oylar" koleksiyonunda toplanır ve tüm ziyaretçilere gösterilir. */

window.FIREBASE_CONFIG = {
  projectId: "kriterinmekan",
  apiKey: "AIzaSyAO2Rep7cs4BJ6Tkv0hOApXerFv1W_VGVY",
};
