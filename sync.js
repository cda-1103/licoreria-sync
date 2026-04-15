const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// Configuración de variables de entorno (GitHub Secrets)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FINA_TOKEN = process.env.FINA_TOKEN;

// Inicialización de Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sincronizarInventario() {
  console.log("🚀 Iniciando sincronización profesional...");

  try {
    const pageSize = 50;
    const totalPaginas = 9; // Total para cubrir tus 431 productos

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
        console.error(`❌ Error en Fina (Página ${pagina}): ${response.status}`);
        continue;
      }

      const json = await response.json();
      
      if (!json.data || json.data.length === 0) {
        console.log(`⚠️ No hay más datos en la página ${pagina}.`);
        break;
      }

      // Localizamos el canal de ventas "Principal"
      const canalPrincipal = json.salesChannels?.find(c => c.name === "Principal");

      // MAPEADO EXACTO A TU TABLA
      const updates = json.data.map(prod => {
        const precioInfo = canalPrincipal?.items?.find(i => i.referenceId === prod._id);
        
        return {
          sku: prod._id,               // Mapeamos el _id de Fina a tu columna 'sku'
          nombre: prod.name,           // Columna 'nombre'
          descripcion: prod.description || '', // Columna 'descripcion'
          precio_usd: precioInfo ? precioInfo.sellingPrice : 0, // Columna 'precio_usd'
          stock: prod.amount || 0,     // Columna 'stock'
          actualizado_en: new Date().toISOString() // Columna 'actualizado_en'
        };
      });

      console.log(`📤 Sincronizando ${updates.length} productos en Supabase...`);

      // Operación UPSERT basada en tu restricción UNIQUE(sku)
      const { data, error } = await supabase
        .from('productos')
        .upsert(updates, { onConflict: 'sku' })
        .select();

      if (error) {
        console.error(`❌ ERROR EN SUPABASE (Pág ${pagina}):`, error.message);
      } else {
        console.log(`✅ Página ${pagina} sincronizada. Productos en lote: ${data.length}`);
      }
    }

    console.log("🏁 ¡Sincronización terminada con éxito!");

  } catch (error) {
    console.error("💥 ERROR CRÍTICO:", error.message);
    process.exit(1);
  }
}

sincronizarInventario();
