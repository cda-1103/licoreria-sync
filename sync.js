const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function sincronizarTodo() {
  console.log("📡 Conectando con la API de Fina...");
  
  try {
    const response = await fetch('https://api.finapartner.com/api/inventory?pageSize=500', {
      headers: { 
        'X-Access-Token': process.env.FINA_TOKEN,
        'Accept': 'application/json'
      }
    });

    const json = await response.json();
    
    // Verificamos si hay datos
    if (!json.data || json.data.length === 0) {
      console.log("⚠️ La API de Fina no devolvió productos. Revisa el TOKEN.");
      return;
    }

    console.log(`📦 Encontrados ${json.data.length} productos en Fina.`);

    // --- PASO 1: Categorías ---
    const nombresCategorias = [...new Set(json.data.map(p => p.category || 'Sin Categoría'))];
    console.log(`📂 Sincronizando ${nombresCategorias.length} categorías...`);
    
    const { data: catInsertadas, error: catError } = await supabase
      .from('categorias')
      .upsert(nombresCategorias.map(n => ({ 
        nombre: n,
        slug: n.toLowerCase().replace(/\s+/g, '-') // Creamos un slug amigable
      })), { onConflict: 'nombre' })
      .select();

    if (catError) throw catError;

    const catMap = {};
    catInsertadas.forEach(c => catMap[c.nombre] = c.id);

    // --- PASO 2: Productos ---
    const updates = json.data.map(prod => {
      return {
        sku: prod._id,
        nombre: prod.name,
        descripcion: prod.description || '',
        precio_usd: prod.sellingPrice || 0, // En tu JSON viene directo como sellingPrice
        stock: prod.amount || 0,
        categoria_id: catMap[prod.category || 'Sin Categoría'],
        actualizado_en: new Date().toISOString()
      };
    });

    console.log(`📤 Actualizando ${updates.length} productos en Supabase...`);
    
    const { error: prodError } = await supabase
      .from('productos')
      .upsert(updates, { onConflict: 'sku' });

    if (prodError) throw prodError;
    
    console.log("✅ ¡Todo sincronizado perfectamente!");

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
}

sincronizarTodo();
