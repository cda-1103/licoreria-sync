const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function sincronizarTodo() {
  try {
    const response = await fetch('https://api.finapartner.com/api/inventory?pageSize=500', {
      headers: { 'X-Access-Token': process.env.FINA_TOKEN }
    });
    const json = await response.json();
    if (!json.data) return;

    // --- PASO 1: Sincronizar Categorías ---
    // Extraemos todos los nombres de categorías únicos que vienen de Fina
    const nombresCategorias = [...new Set(json.data.map(p => p.category || 'Varios'))];
    
    console.log(`📂 Sincronizando ${nombresCategorias.length} categorías...`);
    
    const { data: catInsertadas } = await supabase
      .from('categorias')
      .upsert(nombresCategorias.map(n => ({ nombre: n })), { onConflict: 'nombre' })
      .select();

    // Creamos un "mapa" para convertir nombre -> ID rápido
    const catMap = {};
    catInsertadas.forEach(c => catMap[c.nombre] = c.id);

    // --- PASO 2: Sincronizar Productos ---
    const canalPrincipal = json.salesChannels?.find(c => c.name === "Principal");
    
    const updates = json.data.map(prod => {
      const precioInfo = canalPrincipal?.items?.find(i => i.referenceId === prod._id);
      const nombreCat = prod.category || 'Varios';
      
      return {
        sku: prod._id,
        nombre: prod.name,
        stock: prod.amount || 0,
        precio_usd: precioInfo ? precioInfo.sellingPrice : 0,
        categoria_id: catMap[nombreCat], // <-- AQUÍ SE HACE LA MAGIA
        actualizado_en: new Date().toISOString()
      };
    });

    console.log(`📤 Subiendo ${updates.length} productos vinculados...`);
    
    const { error } = await supabase
      .from('productos')
      .upsert(updates, { onConflict: 'sku' });

    if (error) throw error;
    console.log("✅ Sincronización completa: Categorías y Productos alineados.");

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

sincronizarTodo();
