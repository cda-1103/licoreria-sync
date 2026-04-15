const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// Estos valores se cargan desde los "Secrets" de tu repositorio en GitHub
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FINA_TOKEN = process.env.FINA_TOKEN;

// Inicializamos el cliente de Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sincronizarInventario() {
  console.log("🚀 Iniciando proceso de sincronización...");

  try {
    // Definimos cuántos productos queremos por página (según tu captura, usas 50)
    const pageSize = 50;
    const totalPaginas = 9; // Para cubrir tus ~431 productos

    for (let pagina = 1; pagina <= totalPaginas; pagina++) {
      console.log(`📦 Sincronizando página ${pagina} de ${totalPaginas}...`);

      // URL exacta basada en tu captura de pantalla
      const url = `https://api.finapartner.com/api/inventory?currentPage=${pagina}&pageSize=${pageSize}&sortedColumn=updatedAt&sortedDirection=desc`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Access-Token': FINA_TOKEN, // Usamos el nombre exacto de tu captura
          'Accept': 'application/json',
          'Origin': 'https://bbtiendadelicores.finapartner.com',
          'Referer': 'https://bbtiendadelicores.finapartner.com/'
        }
      });

      if (!response.ok) {
        throw new Error(`Error en Fina (Status ${response.status}): ${response.statusText}`);
      }

      const json = await response.json();
      
      if (!json.data || !json.salesChannels) {
        console.log(`⚠️ La página ${pagina} no devolvió datos válidos.`);
        continue;
      }

      // Localizamos el canal de ventas "Principal" para obtener los precios correctos
      const canalPrincipal = json.salesChannels.find(c => c.name === "Principal");

      const updates = json.data.map(prod => {
        // Buscamos el precio en el canal principal usando el ID de referencia
        const precioInfo = canalPrincipal.items.find(i => i.referenceId === prod._id);
        
        return {
          fina_id: prod._id, // ID único de Fina
          nombre: prod.name,
          stock: prod.amount,
          precio_usd: precioInfo ? precioInfo.sellingPrice : 0,
          categoria_nombre: prod.category || 'Sin categoría',
          actualizado_en: new Date().toISOString()
        };
      });

      // Operación Upsert: Si el fina_id ya existe, actualiza; si no, inserta.
      const { error } = await supabase
        .from('productos')
        .upsert(updates, { onConflict: 'fina_id' });

      if (error) {
        console.error(`❌ Error en Supabase (Pág ${pagina}):`, error.message);
      } else {
        console.log(`✅ Página ${pagina} procesada con éxito.`);
      }
    }

    console.log("🏁 Proceso terminado. Tu inventario está al día.");

  } catch (error) {
    console.error("💥 Error crítico durante la sincronización:", error.message);
    process.exit(1);
  }
}

sincronizarInventario();