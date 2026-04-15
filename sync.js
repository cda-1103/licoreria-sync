const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FINA_TOKEN = process.env.FINA_TOKEN;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sincronizarInventario() {
  console.log("🚀 Iniciando sincronización de depuración...");

  try {
    const pageSize = 50;
    const totalPaginas = 1; // Probemos primero con 1 página para diagnosticar

    for (let pagina = 1; pagina <= totalPaginas; pagina++) {
      console.log(`📡 Consultando Fina - Página ${pagina}...`);

      const url = `https://api.finapartner.com/api/inventory?currentPage=${pagina}&pageSize=${pageSize}&sortedColumn=updatedAt&sortedDirection=desc`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Access-Token': FINA_TOKEN,
          'Accept': 'application/json',
          'Origin': 'https://bbtiendadelicores.finapartner.com',
          'Referer': 'https://bbtiendadelicores.finapartner.com/'
        }
      });

      if (!response.ok) {
        console.error(`❌ Error de Red Fina: ${response.status} ${response.statusText}`);
        return;
      }

      const json = await response.json();
      
      // LOG DE DIAGNÓSTICO: ¿Qué nos trae Fina?
      console.log(`📦 Productos recibidos de Fina: ${json.data ? json.data.length : 0}`);
      
      if (!json.data || json.data.length === 0) {
        console.log("⚠️ Fina no devolvió productos. Revisa si el TOKEN sigue vigente.");
        return;
      }

      const canalPrincipal = json.salesChannels?.find(c => c.name === "Principal");
      if (!canalPrincipal) {
        console.log("⚠️ No se encontró el canal 'Principal'. Canales disponibles:", json.salesChannels?.map(c => c.name));
      }

      const updates = json.data.map(prod => {
        const precioInfo = canalPrincipal?.items?.find(i => i.referenceId === prod._id);
        return {
          fina_id: prod._id,
          nombre: prod.name,
          stock: prod.amount || 0,
          precio_usd: precioInfo ? precioInfo.sellingPrice : 0,
          categoria_nombre: prod.category || 'Varios',
          actualizado_en: new Date().toISOString()
        };
      });

      console.log(`📤 Intentando subir ${updates.length} productos a Supabase...`);

      // LOG DE DIAGNÓSTICO: Resultado de Supabase
      const { data, error } = await supabase
        .from('productos')
        .upsert(updates, { onConflict: 'fina_id' })
        .select(); // Pedimos que nos devuelva lo que insertó para confirmar

      if (error) {
        console.error("❌ ERROR EN SUPABASE:", error);
      } else {
        console.log(`✅ ¡Éxito! Se procesaron ${data.length} filas en la base de datos.`);
      }
    }

  } catch (error) {
    console.error("💥 ERROR CRÍTICO:", error.message);
  }
}

sincronizarInventario();
