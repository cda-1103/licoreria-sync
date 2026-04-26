require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function sincronizarTodo() {
  // ID del canal "Principal" de B.B.T.
  const ID_CANAL_PRINCIPAL = '688913251860c52c656c4f8d'; 
  
  // Cambiamos a /api/products que es el endpoint estándar de catálogo
  const urlApi = 'https://api.finapartner.com/api/products?pageSize=1000';

  if (!process.env.FINA_TOKEN) {
    console.error("❌ ERROR: FINA_TOKEN no definido.");
    return;
  }

  console.log("📡 Conectando con el Catálogo de Productos de Fina...");

  try {
    const response = await fetch(urlApi, {
      headers: {
        'X-Access-Token': process.env.FINA_TOKEN,
        'Accept': 'application/json'
      }
    });

    const json = await response.json();

    // Fina suele enviar los productos en json.data o json.data.docs
    const productosFina = json.data?.docs || json.data || [];

    if (productosFina.length === 0) {
      console.log("⚠️ No se encontraron productos en /api/products.");
      console.log("Estructura recibida:", JSON.stringify(json).substring(0, 300));
      return;
    }

    console.log(`📦 Encontrados ${productosFina.length} productos.`);

    // --- PASO 1: Categorías ---
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

    // --- PASO 2: Productos (Precios exactos y sin duplicados) ---
    const productosVistos = new Set();
    const updates = [];

    productosFina.forEach(prod => {
      // 1. Filtro de nombres duplicados (Para evitar las 2 etiquetas negras)
      const nombreNormalizado = prod.name.trim().toLowerCase();
      if (productosVistos.has(nombreNormalizado)) return;
      productosVistos.add(nombreNormalizado);

      // 2. Búsqueda de precio en el canal Principal
      let precioCorrecto = prod.sellingPrice || 0;
      if (prod.salesChannels && prod.salesChannels.length > 0) {
        const configCanal = prod.salesChannels.find(c => c.salesChannelId === ID_CANAL_PRINCIPAL);
        if (configCanal && configCanal.sellingPrice !== undefined) {
          precioCorrecto = configCanal.sellingPrice;
        }
      }

      // 3. Stock y Categoría
      const stockActual = prod.totalStock !== undefined ? prod.totalStock : (prod.amount || 0);
      const catKey = (prod.category || 'Sin Categoría').toLowerCase().trim();

      updates.push({
        sku: (prod.SKU && prod.SKU !== "") ? prod.SKU : prod._id,
        nombre: prod.name,
        descripcion: prod.description || '',
        precio_usd: precioCorrecto,
        stock: stockActual,
        categoria_id: catMap[catKey] || catMap['sin categoría'],
        actualizado_en: new Date().toISOString()
      });
    });

    console.log(`📤 Actualizando ${updates.length} productos en Supabase...`);

    const { error: prodError } = await supabase
      .from('productos')
      .upsert(updates, { onConflict: 'sku' });

    if (prodError) throw prodError;

    console.log("✅ ¡Sincronización exitosa!");

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
}

sincronizarTodo();