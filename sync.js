require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function sincronizarTodo() {
  const ID_CANAL_PRINCIPAL = '688913251860c52c656c4f8d'; 
  const urlApi = 'https://api.finapartner.com/api/inventory?pageSize=500';

  console.log("📡 Conectando con la API de Inventario de Fina...");

  try {
    const response = await fetch(urlApi, {
      headers: {
        'X-Access-Token': process.env.FINA_TOKEN,
        'Accept': 'application/json'
      }
    });

    const json = await response.json();

    // --- DIAGNÓSTICO DE ESTRUCTURA ---
    // Intentamos encontrar dónde están los productos (puede ser json.data o json.data.docs)
    let productosFina = [];
    if (Array.isArray(json.data)) {
      productosFina = json.data;
    } else if (json.data && Array.isArray(json.data.docs)) {
      productosFina = json.data.docs;
    } else if (json.data && Array.isArray(json.data.products)) {
      productosFina = json.data.products;
    }

    if (productosFina.length === 0) {
      console.log("⚠️ No se detectó un array de productos en json.data");
      console.log("🔍 ESTRUCTURA REAL RECIBIDA:", JSON.stringify(json, null, 2).substring(0, 500) + "..."); 
      return;
    }
    // --- FIN DIAGNÓSTICO ---

    console.log(`📦 Encontrados ${productosFina.length} productos.`);

    // 1. Categorías
    const categoriasUnicas = new Map();
    productosFina.forEach(p => {
      const nombre = (p.category || 'Sin Categoría').trim();
      const slug = nombre.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!categoriasUnicas.has(slug)) categoriasUnicas.set(slug, nombre);
    });

    const { data: finalCats, error: catError } = await supabase
      .from('categorias')
      .upsert(Array.from(categoriasUnicas).map(([slug, nombre]) => ({ nombre, slug })), { onConflict: 'slug' })
      .select();

    if (catError) throw catError;
    const catMap = {};
    finalCats.forEach(c => { catMap[c.nombre.toLowerCase().trim()] = c.id; });

    // 2. Productos
    const productosVistos = new Set();
    const updates = [];

    productosFina.forEach(prod => {
      const nombreNormalizado = prod.name.trim().toLowerCase();
      if (productosVistos.has(nombreNormalizado)) return;
      productosVistos.add(nombreNormalizado);

      // Buscamos el precio del canal B.B.T. Principal
      let precioCorrecto = prod.sellingPrice || 0;
      if (prod.salesChannels) {
        const configCanal = prod.salesChannels.find(c => c.salesChannelId === ID_CANAL_PRINCIPAL);
        if (configCanal) precioCorrecto = configCanal.sellingPrice;
      }

      // El stock en esta API puede venir como 'amount' o 'totalStock'
      const stockActual = prod.amount !== undefined ? prod.amount : (prod.totalStock || 0);

      updates.push({
        sku: prod.SKU || prod._id,
        nombre: prod.name,
        descripcion: prod.description || '',
        precio_usd: precioCorrecto,
        stock: stockActual,
        categoria_id: catMap[(prod.category || 'Sin Categoría').toLowerCase().trim()],
        actualizado_en: new Date().toISOString()
      });
    });

    console.log(`📤 Actualizando ${updates.length} productos únicos en Supabase...`);
    const { error: prodError } = await supabase.from('productos').upsert(updates, { onConflict: 'sku' });
    
    if (prodError) throw prodError;
    console.log("✅ ¡Sincronización exitosa!");

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
}

sincronizarTodo();